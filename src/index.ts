import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import express, { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createAccessTokenStore, getAccessTokenById } from "./access-tokens";
import { registerTools } from "./tools";
import { ExtendedTool, Integration } from "./type";
import {
  createProxyApiTool,
  envs,
  getAllIntegrations,
  getSigningKey,
  Logger,
  signJwt,
} from "./utils";
import { loadCustomOpenApiTools } from "./openapi";
import { getCustomTools } from "./custom-tools";

type Session<TTransport> = {
  transport: TTransport;
  server: Server;
  authentication: RequestAuthentication;
};

type StreamableSession = Session<StreamableHTTPServerTransport> & {
  activeRequests: number;
  authenticationTimeout?: ReturnType<typeof setTimeout>;
  idleTimeout?: ReturnType<typeof setTimeout>;
};

type RequestAuthentication = {
  currentJwt: string;
  expiresAt?: number;
  identity: string;
  principalIdentity: string;
};

type CreateAppOptions = {
  extraTools?: Array<ExtendedTool>;
  enableLegacySse?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  sessionIdleTimeoutMs?: number;
  maxStreamableSessions?: number;
};

function createMcpServer(
  authentication: RequestAuthentication,
  extraTools: Array<ExtendedTool>,
): Server {
  const server = new Server({
    name: "paragon-mcp",
    version: "1.0.0",
  });
  registerTools({
    server,
    getCurrentJwt: () => authentication.currentJwt,
    extraTools,
  });
  return server;
}

function authenticateRequest(
  req: Request,
  res: Response,
): RequestAuthentication | undefined {
  const authorization = req.headers.authorization;
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) {
      res.status(401).send("Unauthorized");
      return undefined;
    }

    const currentJwt = authorization.slice(7).trim();
    if (currentJwt) {
      try {
        const payload = jwt.verify(currentJwt, getSigningKey(), {
          algorithms: ["RS256"],
        });
        if (typeof payload !== "string" && typeof payload.sub === "string") {
          return {
            currentJwt,
            expiresAt:
              typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
            identity: `bearer:${createHash("sha256")
              .update(currentJwt)
              .digest("hex")}`,
            principalIdentity: `bearer-subject:${createHash("sha256")
              .update(payload.sub)
              .digest("hex")}`,
          };
        }
      } catch {
        res.status(401).send("Unauthorized");
        return undefined;
      }
    }

    res.status(401).send("Unauthorized");
    return undefined;
  }

  if (envs.NODE_ENV === "development" && typeof req.query.user === "string") {
    return {
      currentJwt: signJwt({ userId: req.query.user }),
      identity: `development:${req.query.user}`,
      principalIdentity: `development:${req.query.user}`,
    };
  }

  res.status(401).send("Unauthorized");
  return undefined;
}

function getDefaultAllowedHosts(): string[] {
  const allowedHosts = new Set(envs.MCP_ALLOWED_HOSTS);
  try {
    allowedHosts.add(new URL(envs.MCP_SERVER_URL).host);
  } catch {
    Logger.debug(
      "MCP_SERVER_URL is not a valid URL; using explicit hosts only",
    );
  }

  allowedHosts.add(`localhost:${envs.PORT}`);
  allowedHosts.add(`127.0.0.1:${envs.PORT}`);

  return [...allowedHosts];
}

function getDefaultAllowedOrigins(): string[] {
  const allowedOrigins = new Set(envs.MCP_ALLOWED_ORIGINS);
  try {
    allowedOrigins.add(new URL(envs.MCP_SERVER_URL).origin);
  } catch {
    Logger.debug(
      "MCP_SERVER_URL is not a valid URL; using explicit origins only",
    );
  }

  if (envs.NODE_ENV === "development") {
    allowedOrigins.add(`http://localhost:${envs.PORT}`);
    allowedOrigins.add(`http://127.0.0.1:${envs.PORT}`);
  }

  return [...allowedOrigins];
}

function validateMcpRequest(
  req: Request,
  res: Response,
  allowedHosts: string[],
  allowedOrigins: string[],
): boolean {
  const host = req.headers.host;
  if (!host || !allowedHosts.includes(host)) {
    res.status(403).send("Forbidden");
    return false;
  }

  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).send("Forbidden");
    return false;
  }

  return true;
}

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function handleMcpJsonError(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof SyntaxError) {
    sendJsonRpcError(res, 400, -32700, "Parse error");
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 415
  ) {
    sendJsonRpcError(res, 415, -32000, "Unsupported Media Type");
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 413
  ) {
    sendJsonRpcError(res, 413, -32000, "Request body too large");
    return;
  }

  next(error);
}

export function createApp({
  extraTools = [],
  enableLegacySse = envs.ENABLE_LEGACY_SSE,
  allowedHosts = getDefaultAllowedHosts(),
  allowedOrigins = getDefaultAllowedOrigins(),
  sessionIdleTimeoutMs = envs.MCP_SESSION_IDLE_TIMEOUT_MS,
  maxStreamableSessions = envs.MCP_MAX_SESSIONS,
}: CreateAppOptions = {}) {
  createAccessTokenStore();
  const app = express();
  const legacySessions = new Map<string, Session<SSEServerTransport>>();
  const streamableSessions = new Map<string, StreamableSession>();
  let pendingStreamableSessions = 0;

  const deleteStreamableSession = (sessionId: string) => {
    const session = streamableSessions.get(sessionId);
    if (session?.authenticationTimeout) {
      clearTimeout(session.authenticationTimeout);
    }
    if (session?.idleTimeout) {
      clearTimeout(session.idleTimeout);
    }
    streamableSessions.delete(sessionId);
  };

  const expireStreamableSession = (
    sessionId: string,
    session: StreamableSession,
  ) => {
    if (streamableSessions.get(sessionId) !== session) {
      return;
    }
    deleteStreamableSession(sessionId);
    void session.server.close().catch((error) => {
      Logger.debug("Error closing expired Streamable HTTP session:", error);
    });
  };

  const scheduleStreamableSessionAuthenticationExpiry = (
    sessionId: string,
    session: StreamableSession,
  ) => {
    const expiresAt = session.authentication.expiresAt;
    if (expiresAt === undefined) {
      return;
    }
    session.authenticationTimeout = setTimeout(() => {
      expireStreamableSession(sessionId, session);
    }, Math.max(0, expiresAt - Date.now()));
    session.authenticationTimeout.unref();
  };

  const scheduleStreamableSessionExpiry = (
    sessionId: string,
    session: StreamableSession,
  ) => {
    if (session.idleTimeout) {
      clearTimeout(session.idleTimeout);
    }
    session.idleTimeout = setTimeout(() => {
      expireStreamableSession(sessionId, session);
    }, sessionIdleTimeoutMs);
    session.idleTimeout.unref();
  };

  app.use("/static", express.static("static"));
  app.use("/mcp", (req, res, next) => {
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
      res.set("Allow", "GET, POST, DELETE");
      res.sendStatus(405);
      return;
    }

    if (!validateMcpRequest(req, res, allowedHosts, allowedOrigins)) {
      return;
    }

    const authentication = authenticateRequest(req, res);
    if (!authentication) {
      return;
    }

    res.locals.authentication = authentication;
    next();
  });
  app.use("/mcp", express.json({ limit: "4mb" }));
  app.use("/mcp", handleMcpJsonError);

  app.all("/mcp", async (req, res) => {
    const authentication = res.locals.authentication as RequestAuthentication;

    if (req.method === "POST" && !req.is("application/json")) {
      sendJsonRpcError(
        res,
        415,
        -32000,
        "Unsupported Media Type: Content-Type must be application/json",
      );
      return;
    }

    const sessionId = req.header("mcp-session-id");
    const isInitializationRequest =
      !sessionId && req.method === "POST" && isInitializeRequest(req.body);
    let session: StreamableSession | undefined;
    let releaseStreamableSessionReservation: (() => void) | undefined;

    if (sessionId) {
      session = streamableSessions.get(sessionId);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }
      const matchesSessionToken =
        session.authentication.identity === authentication.identity;
      const terminatesOwnedSession =
        req.method === "DELETE" &&
        session.authentication.principalIdentity ===
          authentication.principalIdentity;
      if (!matchesSessionToken && !terminatesOwnedSession) {
        res.status(403).send("Forbidden");
        return;
      }
    } else if (isInitializationRequest) {
      if (
        streamableSessions.size + pendingStreamableSessions >=
        maxStreamableSessions
      ) {
        sendJsonRpcError(res, 503, -32000, "Session capacity reached");
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (initializedSessionId) => {
          streamableSessions.set(initializedSessionId, session!);
          scheduleStreamableSessionAuthenticationExpiry(
            initializedSessionId,
            session!,
          );
          releaseStreamableSessionReservation?.();
        },
        onsessionclosed: (closedSessionId) => {
          deleteStreamableSession(closedSessionId);
        },
      });
      const server = createMcpServer(authentication, extraTools);
      session = {
        transport,
        server,
        authentication,
        activeRequests: 0,
      };
      pendingStreamableSessions += 1;
      let reservationReleased = false;
      releaseStreamableSessionReservation = () => {
        if (reservationReleased) {
          return;
        }
        reservationReleased = true;
        pendingStreamableSessions -= 1;
      };
      server.onclose = () => {
        if (transport.sessionId) {
          deleteStreamableSession(transport.sessionId);
        }
      };
      try {
        await server.connect(transport);
      } catch (error) {
        Logger.debug("Error connecting Streamable HTTP transport:", error);
        releaseStreamableSessionReservation();
        try {
          await server.close();
        } catch (closeError) {
          Logger.debug(
            "Error closing failed Streamable HTTP transport:",
            closeError,
          );
        }
        sendJsonRpcError(res, 500, -32603, "Internal server error");
        return;
      }
    } else {
      sendJsonRpcError(res, 400, -32000, "Mcp-Session-Id header is required");
      return;
    }

    if (session.idleTimeout) {
      clearTimeout(session.idleTimeout);
      session.idleTimeout = undefined;
    }
    session.activeRequests += 1;

    try {
      await session.transport.handleRequest(req, res, req.body);
      if (isInitializationRequest && !session.transport.sessionId) {
        await session.server.close();
      }
    } catch (error) {
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
      if (!session.transport.sessionId) {
        await session.server.close();
      }
      Logger.debug("Error handling Streamable HTTP request:", error);
    } finally {
      releaseStreamableSessionReservation?.();
      session.activeRequests -= 1;
      const initializedSessionId = session.transport.sessionId;
      if (
        initializedSessionId &&
        streamableSessions.get(initializedSessionId) === session &&
        session.activeRequests === 0
      ) {
        scheduleStreamableSessionExpiry(initializedSessionId, session);
      }
    }
  });

  if (enableLegacySse) {
    app.get("/sse", async (req, res) => {
      const authentication = authenticateRequest(req, res);
      if (!authentication) {
        return;
      }

      const transport = new SSEServerTransport("/messages", res);
      const server = createMcpServer(authentication, extraTools);
      const session = {
        transport,
        server,
        authentication,
      };
      legacySessions.set(transport.sessionId, session);
      server.onclose = () => {
        legacySessions.delete(transport.sessionId);
      };

      Logger.debug(
        "Connected legacy clients:",
        [...legacySessions].map(([sessionId, payload]) => ({
          sessionId,
          user: jwt.decode(payload.authentication.currentJwt)?.sub,
        })),
      );

      try {
        await server.connect(transport);
      } catch (error) {
        Logger.debug("Error connecting legacy SSE transport:", error);
        legacySessions.delete(transport.sessionId);
        if (!res.headersSent) {
          res.status(500);
        }
        try {
          await server.close();
        } catch (closeError) {
          Logger.debug(
            "Error closing failed legacy SSE transport:",
            closeError,
          );
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
    });

    app.post("/messages", async (req, res) => {
      const sessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId
          : undefined;
      const session = sessionId ? legacySessions.get(sessionId) : undefined;

      if (!session) {
        res.status(404).json({ error: "No transport found for sessionId" });
        return;
      }

      try {
        await session.transport.handlePostMessage(req, res);
      } catch (error) {
        if (!res.headersSent) {
          res
            .status(500)
            .send(error instanceof Error ? error.message : String(error));
        }
      }
    });
  }

  app.get("/setup", async (req, res) => {
    const tokenId = req.query.token;
    if (!tokenId || typeof tokenId !== "string") {
      return res.status(400).json({ error: "Invalid token" });
    }

    const token = getAccessTokenById(tokenId);
    if (!token) {
      return res.status(400).json({ error: "Invalid token" });
    }

    try {
      jwt.verify(token, getSigningKey());
    } catch (error) {
      return res.status(400).json({ error: "Invalid token" });
    }

    const decoded = jwt.decode(token, { complete: true });
    if (!decoded?.payload || typeof decoded.payload === "string") {
      return res.status(400).json({ error: "Invalid token" });
    }

    const payload = decoded.payload.payload;
    const tokenInfo = {
      projectId: payload.projectId,
      loginToken: payload.loginToken,
      integrationName: payload.integrationName,
    };

    return res.status(200).type("text/html").send(`
      <html>
        <head>
          <script src="${envs.CONNECT_SDK_CDN_URL}"></script>
          <script id="token-info" type="application/json">${JSON.stringify(
            tokenInfo,
          )}</script>
          <script type="text/javascript" src="/static/js/index.js"></script>
        </head>
        <body>
        </body>
      </html>
    `);
  });

  const closeSessions = async () => {
    const streamableServers = [...streamableSessions.values()].map(
      ({ server }) => server,
    );
    for (const sessionId of streamableSessions.keys()) {
      deleteStreamableSession(sessionId);
    }
    await Promise.all([
      ...[...legacySessions.values()].map(({ server }) => server.close()),
      ...streamableServers.map((server) => server.close()),
    ]);
    legacySessions.clear();
  };

  return {
    app,
    closeSessions,
    getSessionCounts: () => ({
      legacy: legacySessions.size,
      streamable: streamableSessions.size,
    }),
  };
}

async function loadExtraTools(): Promise<Array<ExtendedTool>> {
  let extraTools: Array<ExtendedTool> = [];
  const integrations: Array<Integration> =
    (await getAllIntegrations(signJwt({ userId: envs.PROJECT_ID }))) ?? [];

  if (envs.ENABLE_CUSTOM_OPENAPI_ACTIONS) {
    extraTools = await loadCustomOpenApiTools(integrations);
  }
  if (envs.ENABLE_PROXY_API_TOOL) {
    extraTools = extraTools.concat(
      createProxyApiTool(
        integrations.filter((integration) => {
          if (envs.LIMIT_TO_INTEGRATIONS) {
            return envs.LIMIT_TO_INTEGRATIONS.includes(integration.type);
          }
          return true;
        }),
      ),
    );
  }
  if (envs.ENABLE_CUSTOM_TOOL) {
    extraTools = extraTools.concat(getCustomTools());
  }

  return extraTools;
}

async function main() {
  const { app, closeSessions } = createApp({
    extraTools: await loadExtraTools(),
  });
  const httpServer = app.listen(Number(envs.PORT), () => {
    console.log(`Server is running on http://localhost:${envs.PORT}`);
  });

  const handleShutdown = async () => {
    console.log("Closing all transports...");
    await closeSessions();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    process.exit(0);
  };

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
