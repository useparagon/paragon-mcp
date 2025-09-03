import express from "express";
import jwt from "jsonwebtoken";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { createAccessTokenStore, getAccessTokenById } from "./access-tokens";
import { registerTools } from "./tools";
import { ExtendedTool, Integration, TransportPayload } from "./type";
import {
  envs,
  Logger,
  signJwt,
  getSigningKey,
  getAllIntegrations,
  createProxyApiTool,
} from "./utils";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { loadCustomOpenApiTools } from "./openapi";
import { getCustomTools } from "./custom-tools";

let transports: Record<string, TransportPayload> = {};
const server = new Server({
  name: "paragon-mcp",
  version: "1.0.0",
});
let extraTools: Array<ExtendedTool> = [];
let integrations: Array<Integration> = await getAllIntegrations(
  signJwt({ userId: envs.PROJECT_ID })
);
if (envs.ENABLE_CUSTOM_OPENAPI_ACTIONS) {
  extraTools = await loadCustomOpenApiTools(integrations);
}
if (envs.ENABLE_PROXY_API_TOOL) {
  extraTools = extraTools.concat(
    createProxyApiTool(
      integrations.filter((i) => {
        if (envs.LIMIT_TO_INTEGRATIONS) {
          return envs.LIMIT_TO_INTEGRATIONS.includes(i.type);
        }
        return true;
      })
    )
  );
}
if (envs.ENABLE_CUSTOM_TOOL) {
  extraTools = extraTools.concat(getCustomTools());
}
registerTools({ server, extraTools, transports });

async function main() {
  createAccessTokenStore();

  const app = express();

  // Add CORS headers for cross-origin requests
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  app.use("/static", express.static("static"));

  app.get("/sse", async (req, res) => {
    let currentJwt = req.headers.authorization;

    if (currentJwt && currentJwt.startsWith("Bearer ")) {
      currentJwt = currentJwt.slice(7).trim();
    } else if (envs.NODE_ENV === "development" && req.query.user) {
      // In development, allow `user=` query parameter to be used
      currentJwt = signJwt({ userId: req.query.user as string });
    } else {
      return res.status(401).send("Unauthorized");
    }

    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = { transport, currentJwt };

    Logger.debug(
      "Connected clients:",
      Object.keys(transports).map((key) => ({
        sessionId: key,
        user: jwt.decode(transports[key].currentJwt)?.sub,
      }))
    );

    res.on("close", () => {
      Logger.debug("Client disconnected: ", transport.sessionId);
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transportPayload = transports[sessionId];

    if (sessionId && transportPayload) {
      try {
        return await transportPayload.transport.handlePostMessage(req, res);
      } catch (err) {
        if (!res.headersSent) {
          return res.status(500).send(err instanceof Error ? err.message : err);
        }
      }
    }

    console.error("No transport found for sessionId", sessionId);
    return res.status(404).json({ error: "No transport found for sessionId" });
  });

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

  app.listen(Number(envs.PORT), "0.0.0.0");
  console.log(`Server is running on`, `http://0.0.0.0:${envs.PORT}`);
}

const handleShutdown = async () => {
  console.log("Closing all transports...");
  await Promise.all(
    Object.values(transports).map(async (transport) => {
      await transport.transport.close();
    })
  );
  await server.close();
  for (const key in transports) {
    delete transports[key];
  }
  process.exit(0);
};

process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);

main();
