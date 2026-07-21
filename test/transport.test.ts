import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import jwt from "jsonwebtoken";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createApp } from "../src/index";

const activeServers = new Set<Awaited<ReturnType<typeof startServer>>>();
const execFileAsync = promisify(execFile);

function signToken(subject: string, expiresInSeconds = 60 * 60): string {
  return jwt.sign({}, process.env.SIGNING_KEY!, {
    algorithm: "RS256",
    subject,
    expiresIn: expiresInSeconds,
    jwtid: randomUUID(),
  });
}

async function startServer(
  enableLegacySse?: boolean,
  allowListeningHost = true,
  sessionIdleTimeoutMs = 30 * 60 * 1000,
  maxStreamableSessions = 1000,
) {
  const allowedHosts: string[] = [];
  const instance = createApp({
    enableLegacySse,
    allowedHosts,
    allowedOrigins: [],
    sessionIdleTimeoutMs,
    maxStreamableSessions,
  });
  const server = await new Promise<ReturnType<typeof instance.app.listen>>(
    (resolve) => {
      const listeningServer = instance.app.listen(0, "127.0.0.1", () => {
        resolve(listeningServer);
      });
    },
  );
  const address = server.address() as AddressInfo;
  if (allowListeningHost) {
    allowedHosts.push(`127.0.0.1:${address.port}`);
  }

  const runningServer = {
    ...instance,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await instance.closeSessions();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
  activeServers.add(runningServer);
  return runningServer;
}

function requestSessionInitialization(baseUrl: string, token: string) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "paragon-mcp-test",
          version: "1.0.0",
        },
      },
    }),
  });
}

async function initializeSession(baseUrl: string, token: string) {
  const response = await requestSessionInitialization(baseUrl, token);
  const responseBody = await response.text();
  assert.equal(response.status, 200, responseBody);
  assert.match(responseBody, /"serverInfo"/);

  const sessionId = response.headers.get("mcp-session-id");
  assert.ok(sessionId);
  return sessionId;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function sendInitializedNotification(
  baseUrl: string,
  token: string,
  sessionId: string,
) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
}

async function terminateSession(
  baseUrl: string,
  token: string,
  sessionId: string,
) {
  return fetch(`${baseUrl}/mcp`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": "2025-11-25",
    },
  });
}

afterEach(async () => {
  await Promise.all([...activeServers].map((server) => server.close()));
  activeServers.clear();
});

test("handles the stateful Streamable HTTP session lifecycle", async () => {
  const server = await startServer();
  const token = signToken("user-1");
  const sessionId = await initializeSession(server.baseUrl, token);
  assert.deepEqual(server.getSessionCounts(), {
    legacy: 0,
    streamable: 1,
  });

  const initializedResponse = await sendInitializedNotification(
    server.baseUrl,
    token,
    sessionId,
  );
  assert.equal(initializedResponse.status, 202);

  const controller = new AbortController();
  const streamResponse = await fetch(`${server.baseUrl}/mcp`, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": sessionId,
      "MCP-Protocol-Version": "2025-11-25",
    },
    signal: controller.signal,
  });
  assert.equal(streamResponse.status, 200);
  assert.match(
    streamResponse.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  controller.abort();

  const deleteResponse = await terminateSession(
    server.baseUrl,
    token,
    sessionId,
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(server.getSessionCounts(), {
    legacy: 0,
    streamable: 0,
  });
});

test("returns protocol errors for missing and unknown sessions", async () => {
  const server = await startServer();
  const token = signToken("user-1");

  const missingResponse = await fetch(`${server.baseUrl}/mcp`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(missingResponse.status, 400);
  assert.equal((await missingResponse.json()).error.code, -32000);

  const unknownResponse = await fetch(`${server.baseUrl}/mcp`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": "missing-session",
    },
  });
  assert.equal(unknownResponse.status, 404);
  assert.equal((await unknownResponse.json()).error.code, -32001);
});

test("returns JSON-RPC parse errors for malformed request bodies", async () => {
  const server = await startServer();
  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signToken("user-1")}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32700);
});

test("returns 415 for unsupported Streamable HTTP content types", async () => {
  const server = await startServer();
  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signToken("user-1")}`,
      "Content-Type": "text/plain",
    },
    body: "{}",
  });

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, -32000);

  const encodingResponse = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signToken("user-1")}`,
      "Content-Encoding": "compress",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(encodingResponse.status, 415);
  assert.equal((await encodingResponse.json()).error.code, -32000);
});

test("cleans up rejected initialization requests", async () => {
  const server = await startServer();
  const token = signToken("user-1");
  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "paragon-mcp-test",
          version: "1.0.0",
        },
      },
    }),
  });

  assert.equal(response.status, 406);
  assert.deepEqual(server.getSessionCounts(), {
    legacy: 0,
    streamable: 0,
  });
});

test("authenticates every request and isolates session owners", async () => {
  const server = await startServer();
  const ownerToken = signToken("owner");
  const otherToken = signToken("other");
  const rotatedOwnerToken = signToken("owner");
  const sessionId = await initializeSession(server.baseUrl, ownerToken);

  const missingAuthResponse = await fetch(`${server.baseUrl}/mcp`, {
    headers: {
      "Mcp-Session-Id": sessionId,
    },
  });
  assert.equal(missingAuthResponse.status, 401);

  const wrongOwnerResponse = await sendInitializedNotification(
    server.baseUrl,
    otherToken,
    sessionId,
  );
  assert.equal(wrongOwnerResponse.status, 403);

  const rotatedTokenResponse = await sendInitializedNotification(
    server.baseUrl,
    rotatedOwnerToken,
    sessionId,
  );
  assert.equal(rotatedTokenResponse.status, 403);

  const invalidTokenResponse = await fetch(`${server.baseUrl}/mcp`, {
    headers: {
      Authorization: "Bearer invalid",
      "Mcp-Session-Id": sessionId,
    },
  });
  assert.equal(invalidTokenResponse.status, 401);
});

test("lets owners terminate sessions after rotation and rejects expired tokens", async () => {
  const server = await startServer(undefined, true, 30 * 60 * 1000, 1);
  const originalToken = signToken("owner");
  const rotatedToken = signToken("owner");
  const expiredToken = signToken("owner", -1);
  const originalSessionId = await initializeSession(
    server.baseUrl,
    originalToken,
  );

  const otherUserDeleteResponse = await terminateSession(
    server.baseUrl,
    signToken("other"),
    originalSessionId,
  );
  assert.equal(otherUserDeleteResponse.status, 403);
  assert.equal(server.getSessionCounts().streamable, 1);

  const expiredDeleteResponse = await terminateSession(
    server.baseUrl,
    expiredToken,
    originalSessionId,
  );
  assert.equal(expiredDeleteResponse.status, 401);
  assert.equal(server.getSessionCounts().streamable, 1);

  const rotatedDeleteResponse = await terminateSession(
    server.baseUrl,
    rotatedToken,
    originalSessionId,
  );
  assert.equal(rotatedDeleteResponse.status, 200);
  assert.equal(server.getSessionCounts().streamable, 0);

  const replacementResponse = await requestSessionInitialization(
    server.baseUrl,
    signToken("replacement"),
  );
  assert.equal(replacementResponse.status, 200);
});

test("releases session capacity when the initializing token expires", async () => {
  const server = await startServer(undefined, true, 30 * 60 * 1000, 1);
  await initializeSession(server.baseUrl, signToken("expiring", 1));

  const capacityResponse = await requestSessionInitialization(
    server.baseUrl,
    signToken("replacement"),
  );
  assert.equal(capacityResponse.status, 503);

  await waitFor(() => server.getSessionCounts().streamable === 0, 1500);

  const replacementResponse = await requestSessionInitialization(
    server.baseUrl,
    signToken("replacement"),
  );
  assert.equal(replacementResponse.status, 200);
});

test("chunks authentication expiry timers for long-lived tokens", async (t) => {
  const setTimeoutMock = t.mock.method(globalThis, "setTimeout");
  const server = await startServer();
  await initializeSession(
    server.baseUrl,
    signToken("long-lived", 60 * 24 * 60 * 60),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  const timeoutDelays = setTimeoutMock.mock.calls
    .map((call) => call.arguments[1])
    .filter(
      (delay): delay is number =>
        typeof delay === "number" && Number.isFinite(delay),
    );
  assert.ok(timeoutDelays.includes(2 ** 31 - 1));
  assert.ok(timeoutDelays.every((delay) => delay <= 2 ** 31 - 1));
  assert.equal(server.getSessionCounts().streamable, 1);
});

test("chunks long idle expiry timers", async (t) => {
  const setTimeoutMock = t.mock.method(globalThis, "setTimeout");
  const server = await startServer(undefined, true, 60 * 24 * 60 * 60 * 1000);
  await initializeSession(server.baseUrl, signToken("long-idle"));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const timeoutDelays = setTimeoutMock.mock.calls
    .map((call) => call.arguments[1])
    .filter(
      (delay): delay is number =>
        typeof delay === "number" && Number.isFinite(delay),
    );
  assert.ok(timeoutDelays.includes(2 ** 31 - 1));
  assert.ok(timeoutDelays.every((delay) => delay <= 2 ** 31 - 1));
  assert.equal(server.getSessionCounts().streamable, 1);
});

test("does not expire a session from a stale idle timer", async (t) => {
  const originalConnect = Server.prototype.connect;
  const setTimeoutMock = t.mock.method(globalThis, "setTimeout");
  let connectedTransport: StreamableHTTPServerTransport | undefined;
  let releaseRequest: () => void = () => {};

  Server.prototype.connect = async function (transport) {
    connectedTransport = transport as StreamableHTTPServerTransport;
    await originalConnect.call(this, transport);
  };

  try {
    const idleTimeoutMs = 123_456;
    const server = await startServer(undefined, true, idleTimeoutMs);
    const token = signToken("active-request");
    const sessionId = await initializeSession(server.baseUrl, token);
    assert.ok(connectedTransport);

    const idleTimerCall = [...setTimeoutMock.mock.calls]
      .reverse()
      .find((call) => {
        const delay = call.arguments[1];
        return (
          typeof delay === "number" &&
          delay <= idleTimeoutMs &&
          delay > idleTimeoutMs - 1000
        );
      });
    assert.ok(idleTimerCall);
    const idleTimerCallback = idleTimerCall.arguments[0] as () => void;

    const originalHandleRequest =
      connectedTransport.handleRequest.bind(connectedTransport);
    let notifyRequestStarted: () => void = () => {};
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    const requestReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    connectedTransport.handleRequest = async (req, res, parsedBody) => {
      notifyRequestStarted();
      await requestReleased;
      await originalHandleRequest(req, res, parsedBody);
    };

    const activeRequest = sendInitializedNotification(
      server.baseUrl,
      token,
      sessionId,
    );
    await requestStarted;
    idleTimerCallback();
    assert.equal(server.getSessionCounts().streamable, 1);

    releaseRequest();
    const response = await activeRequest;
    assert.equal(response.status, 202);
  } finally {
    releaseRequest();
    Server.prototype.connect = originalConnect;
  }
});

test("keeps concurrent Streamable HTTP sessions isolated", async () => {
  const server = await startServer();
  const firstToken = signToken("first");
  const secondToken = signToken("second");
  const [firstSessionId, secondSessionId] = await Promise.all([
    initializeSession(server.baseUrl, firstToken),
    initializeSession(server.baseUrl, secondToken),
  ]);

  assert.notEqual(firstSessionId, secondSessionId);
  assert.deepEqual(server.getSessionCounts(), {
    legacy: 0,
    streamable: 2,
  });

  const responses = await Promise.all([
    terminateSession(server.baseUrl, firstToken, firstSessionId),
    terminateSession(server.baseUrl, secondToken, secondSessionId),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
});

test("enforces the Streamable HTTP session limit during initialization", async () => {
  const originalConnect = Server.prototype.connect;
  let releaseFirstConnect: () => void = () => {};
  const firstConnectReleased = new Promise<void>((resolve) => {
    releaseFirstConnect = resolve;
  });
  let notifyFirstConnectStarted: () => void = () => {};
  const firstConnectStarted = new Promise<void>((resolve) => {
    notifyFirstConnectStarted = resolve;
  });
  let connectCalls = 0;

  Server.prototype.connect = async function (transport) {
    connectCalls += 1;
    if (connectCalls === 1) {
      notifyFirstConnectStarted();
      await firstConnectReleased;
    }
    await originalConnect.call(this, transport);
  };

  try {
    const server = await startServer(undefined, true, 30 * 60 * 1000, 1);
    const firstRequest = requestSessionInitialization(
      server.baseUrl,
      signToken("first"),
    );
    await firstConnectStarted;

    const secondResponse = await requestSessionInitialization(
      server.baseUrl,
      signToken("second"),
    );
    releaseFirstConnect();
    const firstResponse = await firstRequest;

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 503);
    assert.equal(connectCalls, 1);
    assert.equal(server.getSessionCounts().streamable, 1);
  } finally {
    releaseFirstConnect();
    Server.prototype.connect = originalConnect;
  }
});

test("closes Streamable HTTP resources when connect fails", async () => {
  const originalConnect = Server.prototype.connect;
  let serverCloseCalls = 0;
  let transportCloseCalls = 0;

  Server.prototype.connect = async function (transport) {
    const originalServerClose = this.close.bind(this);
    this.close = async () => {
      serverCloseCalls += 1;
      await originalServerClose();
    };
    const originalTransportClose = transport.close.bind(transport);
    transport.close = async () => {
      transportCloseCalls += 1;
      await originalTransportClose();
    };
    transport.start = async () => {
      throw new Error("forced connect failure");
    };
    await originalConnect.call(this, transport);
  };

  try {
    const server = await startServer();
    const response = await requestSessionInitialization(
      server.baseUrl,
      signToken("connect-failure"),
    );

    assert.equal(response.status, 500);
    assert.equal(serverCloseCalls, 1);
    assert.equal(transportCloseCalls, 1);
    assert.equal(server.getSessionCounts().streamable, 0);
  } finally {
    Server.prototype.connect = originalConnect;
  }
});

test("removes Streamable HTTP sessions when the transport closes", async () => {
  const originalConnect = Server.prototype.connect;
  let connectedTransport: Parameters<Server["connect"]>[0] | undefined;

  Server.prototype.connect = async function (transport) {
    connectedTransport = transport;
    await originalConnect.call(this, transport);
  };

  try {
    const server = await startServer();
    await initializeSession(server.baseUrl, signToken("closed-transport"));
    assert.equal(server.getSessionCounts().streamable, 1);
    assert.ok(connectedTransport);

    await connectedTransport.close();
    await waitFor(() => server.getSessionCounts().streamable === 0);
  } finally {
    Server.prototype.connect = originalConnect;
  }
});

test("expires abandoned Streamable HTTP sessions", async () => {
  const server = await startServer(undefined, true, 20);
  const token = signToken("idle-user");
  await initializeSession(server.baseUrl, token);
  assert.equal(server.getSessionCounts().streamable, 1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(server.getSessionCounts().streamable, 0);
});

test("serves legacy SSE by default", async () => {
  const server = await startServer();
  const token = signToken("legacy-user");
  const controller = new AbortController();
  const response = await fetch(`${server.baseUrl}/sse`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: controller.signal,
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  const reader = response.body!.getReader();
  const firstEvent = await reader.read();
  assert.match(new TextDecoder().decode(firstEvent.value), /event: endpoint/);
  assert.deepEqual(server.getSessionCounts(), {
    legacy: 1,
    streamable: 0,
  });
  controller.abort();
  await waitFor(() => server.getSessionCounts().legacy === 0);
});

test("cleans up legacy SSE resources when connect fails", async () => {
  const originalConnect = Server.prototype.connect;
  let serverCloseCalls = 0;
  let transportCloseCalls = 0;

  Server.prototype.connect = async function (transport) {
    const originalServerClose = this.close.bind(this);
    this.close = async () => {
      serverCloseCalls += 1;
      await originalServerClose();
    };
    const originalTransportClose = transport.close.bind(transport);
    transport.close = async () => {
      transportCloseCalls += 1;
      await originalTransportClose();
    };
    transport.start = async () => {
      throw new Error("forced legacy connect failure");
    };
    await originalConnect.call(this, transport);
  };

  try {
    const server = await startServer();
    const response = await fetch(`${server.baseUrl}/sse`, {
      headers: {
        Authorization: `Bearer ${signToken("legacy-connect-failure")}`,
      },
    });

    assert.equal(response.status, 500);
    assert.equal(serverCloseCalls, 1);
    assert.equal(transportCloseCalls, 1);
    assert.equal(server.getSessionCounts().legacy, 0);
  } finally {
    Server.prototype.connect = originalConnect;
  }
});

test("removes legacy routes when SSE is explicitly disabled", async () => {
  const server = await startServer(false);
  const token = signToken("legacy-user");

  const sseResponse = await fetch(`${server.baseUrl}/sse`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const messagesResponse = await fetch(
    `${server.baseUrl}/messages?sessionId=missing`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );

  assert.equal(sseResponse.status, 404);
  assert.equal(messagesResponse.status, 404);
});

test("parses ENABLE_LEGACY_SSE=false without boolean coercion", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      'import { envs } from "./src/utils.ts"; process.stdout.write(JSON.stringify({ legacy: envs.ENABLE_LEGACY_SSE, url: envs.MCP_SERVER_URL }));',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ENABLE_LEGACY_SSE: "false",
        MCP_SERVER_URL: "",
      },
    },
  );
  assert.deepEqual(JSON.parse(stdout), {
    legacy: false,
    url: "http://localhost:3001",
  });
});

test("rejects untrusted hosts and origins", async () => {
  const untrustedHostServer = await startServer(true, false);
  const token = signToken("user-1");

  const hostResponse = await fetch(`${untrustedHostServer.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(hostResponse.status, 403);

  const untrustedOriginServer = await startServer();
  const originResponse = await fetch(`${untrustedOriginServer.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: "{",
  });
  assert.equal(originResponse.status, 403);
});

test("authenticates MCP requests before parsing JSON bodies", async () => {
  const server = await startServer();
  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{",
  });

  assert.equal(response.status, 401);
});

test("keeps the setup endpoint behavior unchanged", async () => {
  const server = await startServer();
  const response = await fetch(`${server.baseUrl}/setup?token=missing`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid token" });
});
