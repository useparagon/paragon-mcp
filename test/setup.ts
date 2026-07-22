import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

process.env.PROJECT_ID = "test-project";
process.env.SIGNING_KEY = privateKey.export({
  type: "pkcs8",
  format: "pem",
}).toString();
process.env.NODE_ENV = "production";
process.env.MCP_SERVER_URL = "http://127.0.0.1";
