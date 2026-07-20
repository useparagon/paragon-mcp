import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import express, { Request, Response } from "express";
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
  identity: string;
};

type RequestAuthentication = {
  currentJwt: string;
  identity: string;
};

type CreateAppOptions = {
  extraTools?: Array<ExtendedTool>;
  enableLegacySse?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
};

function createMcpServer(
  currentJwt: string,
  extraTools: Array<ExtendedTool>
): Server {
  const server = new Server({
    name: "paragon-mcp",
    version: "1.0.0",
  });
  registerTools({ server, currentJwt, extraTools });
  return server;
}

function authenticateRequest(
  req: Request,
  res: Response
): RequestAuthentication | undefined {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const currentJwt = authorization.slice(7).trim();
    if (currentJwt) {
      return {
        currentJwt,
        identity: `bearer:${currentJwt}`,
      };
    }
  }

  if (envs.NODE_ENV === "development" && typeof req.query.user === "string") {
    return {
      currentJwt: signJwt({ userId: req.query.user }),
      identity: `development:${req.query.user}`,
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
    Logger.debug("MCP_SERVER_URL is not a valid URL; using explicit hosts only");
  }

  if (envs.NODE_ENV === "development") {
    allowedHosts.add(`localhost:${envs.PORT}`);
    allowedHosts.add(`127.0.0.1:${envs.PORT}`);
  }

  return [...allowedHosts];
}

function getDefaultAllowedOrigins(): string[] {
  const allowedOrigins = new Set(envs.MCP_ALLOWED_ORIGINS);
  try {
    allowedOrigins.add(new URL(envs.MCP_SERVER_URL).origin);
  } catch {
    Logger.debug("MCP_SERVER_URL is not a valid URL; using explicit origins only");
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
  allowedOrigins: string[]
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
  message: string
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

export function createApp({
  extraTools = [],
  enableLegacySse = envs.ENABLE_LEGACY_SSE,
  allowedHosts = getDefaultAllowedHosts(),
  allowedOrigins = getDefaultAllowedOrigins(),
}: CreateAppOptions = {}) {
  const app = express();
  const legacySessions = new Map<
    string,
    Session<SSEServerTransport>
  >();
  const streamableSessions = new Map<
    string,
    Session<StreamableHTTPServerTransport>
  >();

  app.use(express.json());
  app.use("/static", express.static("static"));

  app.all("/mcp", async (req, res) => {
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

    const sessionId = req.header("mcp-session-id");
    let session: Session<StreamableHTTPServerTransport> | undefined;

    if (sessionId) {
      session = streamableSessions.get(sessionId);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }
      if (session.identity !== authentication.identity) {
        res.status(403).send("Forbidden");
        return;
      }
    } else if (req.method === "POST" && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (initializedSessionId) => {
          streamableSessions.set(initializedSessionId, session!);
        },
        onsessionclosed: (closedSessionId) => {
          streamableSessions.delete(closedSessionId);
        },
      });
      const server = createMcpServer(authentication.currentJwt, extraTools);
      session = {
        transport,
        server,
        identity: authentication.identity,
      };
      transport.onclose = () => {
        if (transport.sessionId) {
          streamableSessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
    } else {
      sendJsonRpcError(
        res,
        400,
        -32000,
        "Mcp-Session-Id header is required"
      );
      return;
    }

    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
      if (!session.transport.sessionId) {
        await session.server.close();
      }
      Logger.debug("Error handling Streamable HTTP request:", error);
    }
  });

  if (enableLegacySse) {
    app.get("/sse", async (req, res) => {
      const authentication = authenticateRequest(req, res);
      if (!authentication) {
        return;
      }

      const transport = new SSEServerTransport("/messages", res);
      const server = createMcpServer(authentication.currentJwt, extraTools);
      const session = {
        transport,
        server,
        identity: authentication.identity,
      };
      legacySessions.set(transport.sessionId, session);
      transport.onclose = () => {
        legacySessions.delete(transport.sessionId);
      };

      Logger.debug(
        "Connected legacy clients:",
        [...legacySessions].map(([sessionId, payload]) => ({
          sessionId,
          user: jwt.decode(authentication.currentJwt)?.sub,
          identity: payload.identity,
        }))
      );

      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId
          : undefined;
      const session = sessionId
        ? legacySessions.get(sessionId)
        : undefined;

      if (!session) {
        res.status(404).json({ error: "No transport found for sessionId" });
        return;
      }

      try {
        await session.transport.handlePostMessage(req, res, req.body);
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
            tokenInfo
          )}</script>
          <script type="text/javascript" src="/static/js/index.js"></script>
        </head>
        <body>
        </body>
      </html>
    `);
  });

  const closeSessions = async () => {
    await Promise.all([
      ...[...legacySessions.values()].map(({ server }) => server.close()),
      ...[...streamableSessions.values()].map(({ server }) => server.close()),
    ]);
    legacySessions.clear();
    streamableSessions.clear();
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
        })
      )
    );
  }
  if (envs.ENABLE_CUSTOM_TOOL) {
    extraTools = extraTools.concat(getCustomTools());
  }

  return extraTools;
}

async function main() {
  createAccessTokenStore();
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
