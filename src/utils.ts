import { z } from "zod";
import jwt from "jsonwebtoken";
import fs from "fs";

import { UserNotConnectedError } from "./errors";
import {
  ExtendedTool,
  LinkConnectionProps,
  Integration,
  ProxyApiRequestToolArgs,
} from "./type";
import { createAccessToken } from "./access-tokens";
import { openApiRequests } from "./openapi";
import { OpenAPIV3 } from "openapi-types";

export const envs = z
  .object({
    MCP_SERVER_URL: z.string().default(`http://localhost`),
    PROJECT_ID: z.string(),
    SIGNING_KEY: z.string().optional(),
    SIGNING_KEY_PATH: z.string().optional(),
    PORT: z.string().default("3001"),
    ZEUS_BASE_URL: z.string().default("https://zeus.useparagon.com"),
    PROXY_BASE_URL: z.string().default("https://proxy.useparagon.com"),
    CONNECT_SDK_CDN_URL: z
      .string()
      .default("https://cdn.useparagon.com/latest/sdk/index.js"),
    ACTIONKIT_BASE_URL: z.string().default("https://actionkit.useparagon.com"),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    ENABLE_CUSTOM_OPENAPI_ACTIONS: z.boolean({ coerce: true }).default(false),
    ENABLE_PROXY_API_TOOL: z.boolean({ coerce: true }).default(false),
    ENABLE_CUSTOM_TOOL: z.boolean({ coerce: true }).default(false),
    LIMIT_TO_INTEGRATIONS: z
      .string()
      .default("")
      .transform((val) =>
        val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    LIMIT_TO_TOOLS: z
      .string()
      .default("")
      .transform((val) =>
        val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),

  })
  .parse(process.env);

export const MCP_SERVER_DOMAIN =
  envs.NODE_ENV === "development"
    ? `${envs.MCP_SERVER_URL}:${envs.PORT}`
    : envs.MCP_SERVER_URL;

export async function getActions(jwt: string): Promise<any | null> {
  try {
    const url = `${envs.ACTIONKIT_BASE_URL}/projects/${envs.PROJECT_ID}/actions?limit_to_available=false`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!response.ok) {
      const { message } = await response.json();
      throw new Error(
        `HTTP error; status: ${response.status}; message: ${message}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Could not make ActionKit POST request: " + error);
    return null;
  }
}

export async function performOpenApiAction(
  action: ExtendedTool,
  actionParams: { params: any; body: any },
  jwt: string
): Promise<any | null> {
  const request = openApiRequests[action.name];
  if (!request) {
    throw new Error(`No request found for action ${action.name}`);
  }

  const resolvedRequestPath = `${request.baseUrl ? request.baseUrl : ""
    }${request.path.replace(
      /\{(\w+)\}/g,
      (_match: string, p1: string) => actionParams.params[p1]
    )}`;

  let url = `${envs.PROXY_BASE_URL}/projects/${envs.PROJECT_ID}/sdk/proxy/${action.integrationName}`;
  const urlParams = new URLSearchParams(
    request.params
      .filter((param) => param.in === "query")
      .filter((param) => actionParams.params[param.name])
      .map((param) => [param.name, actionParams.params[param.name]])
  );

  const response = await fetch(url, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "X-Paragon-Proxy-Url": resolvedRequestPath.concat(`?${urlParams.toString()}`),
      "X-Paragon-Use-Raw-Response": "true",
    },
    body:
      request.method.toLowerCase() === OpenAPIV3.HttpMethods.GET
        ? undefined
        : JSON.stringify(actionParams),
  });
  await handleResponseErrors(response);
  return await response.text();
}

export async function performAction(
  actionName: string,
  actionParams: any,
  jwt: string
): Promise<any | null> {
  console.log(`DEBUG:`, "Running action", actionName, actionParams);
  try {
    const url = `${envs.ACTIONKIT_BASE_URL}/projects/${envs.PROJECT_ID}/actions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ action: actionName, parameters: actionParams }),
    });
    await handleResponseErrors(response);

    return await response.json();
  } catch (error) {
    throw error;
  }
}

export function getSigningKey(): string {
  if (envs.SIGNING_KEY_PATH) {
    try {
      return fs
        .readFileSync(envs.SIGNING_KEY_PATH, "utf8")
        .replaceAll("\\n", "\n");
    } catch (error) {
      console.error("Error reading signing key file:", error);
      throw new Error("Failed to read signing key file");
    }
  }

  if (!envs.SIGNING_KEY) {
    throw new Error("Neither SIGNING_KEY nor SIGNING_KEY_PATH is set");
  }

  return envs.SIGNING_KEY.replaceAll("\\n", "\n");
}

export function signJwt({
  userId,
  personaId,
  integrationId,
  integrationName,
  projectId,
  loginToken,
}: LinkConnectionProps): string {
  const currentTime = Math.floor(Date.now() / 1000);
  const signingKey = getSigningKey();

  return jwt.sign(
    {
      payload: {
        ...(personaId && { personaId }),
        ...(integrationId && { integrationId }),
        ...(integrationName && { integrationName }),
        ...(projectId && { projectId }),
        ...(loginToken && { loginToken }),
      },
      sub: userId,
      iat: currentTime,
      exp: currentTime + 60 * 60 * 24 * 7, // 1 week from now
    },
    signingKey,
    {
      algorithm: "RS256",
    }
  );
}

export function decodeJwt(token: string) {
  return jwt.decode(token, { complete: true });
}

export async function getTools(jwt: string): Promise<Array<ExtendedTool>> {
  const tools: Array<ExtendedTool> = [];
  const actionPayload = await getActions(jwt);
  const actions = actionPayload.actions;

  for (const integration of Object.keys(actions)) {
    for (const action of actions[integration]) {
      const tool: ExtendedTool = {
        isOpenApiTool: false,
        name: action["function"]["name"],
        description: action["function"]["description"],
        inputSchema: action["function"]["parameters"],
        integrationName: integration,
        requiredFields: action["function"]["parameters"]["required"],
      };
      tools.push(tool);
    }
  }
  return tools;
}


export async function generateSetupLink({
  integrationName,
  projectId,
  userId,
}: LinkConnectionProps) {
  const loginToken = signJwt({
    userId,
  });
  const token = signJwt({
    integrationName,
    projectId,
    loginToken,
  });

  const id = createAccessToken(token);

  return `${MCP_SERVER_DOMAIN}/setup?token=${id}`;
}

export async function getAllIntegrations(jwt: string): Promise<any | null> {
  try {
    const response = await fetch(
      `${envs.ZEUS_BASE_URL}/projects/${envs.PROJECT_ID}/sdk/integrations`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + jwt,
        },
      }
    );
    return await response.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

export const Logger = {
  debug: (...args: any[]) => {
    if (envs.NODE_ENV !== "development") {
      return;
    }

    console.log(`DEBUG:`, ...args);
  },
};

/**
 * 1 minute in seconds
 */
export const MINUTES = 60;

export async function handleResponseErrors(response: Response): Promise<void> {
  if (!response.ok) {
    const errorResponse = await response.json();
    if (errorResponse.message === "Integration not enabled for user.") {
      throw new UserNotConnectedError(
        "Integration not enabled for user.",
        errorResponse
      );
    }
    throw new Error(
      `HTTP error; status: ${response.status}; message: ${errorResponse.message}`
    );
  }
}

export function createProxyApiTool(integrations: Integration[]): ExtendedTool {
  const integrationNames = integrations.map((i) => i.type);

  return {
    name: "CALL_API_REQUEST",
    description: `Call an API if no tool is available for an integration that matches the user's request. Always follow the following guidelines:
- Before using this tool, respond with a plan that outlines the requests that you will need to make to fulfill the user's goal.
- If you find that you need to make multiple requests to fulfill the user's goal, you can use this tool multiple times.
- If there are errors, don't give up! Try to fix them by using the response to look at the error and adjust the request body accordingly.`,
    integrationName: "general",
    integrationId: undefined,
    requiredFields: ["integration", "url", "httpMethod"],
    isOpenApiTool: false,
    inputSchema: {
      type: "object",
      properties: {
        integration: {
          type: "string",
          description: "The name of the integration to use for this request.",
          enum: integrationNames,
        },
        url: {
          type: "string",
          description:
            "Use the full URL when specifying the `url` parameter, including the base URL. It should NEVER be a relative path - always a full URL.",
        },
        httpMethod: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        queryParams: {
          type: "object",
          additionalProperties: true,
        },
        headers: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
          description: "Do not include any Authorization headers.",
        },
        body: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["integration", "url", "httpMethod"],
      additionalProperties: false,
    },
  };
}

export async function performProxyApiRequest(
  args: ProxyApiRequestToolArgs,
  jwt: string
): Promise<any> {
  const queryStr = args.queryParams
    ? `?${new URLSearchParams(
      Object.entries(args.queryParams).reduce((acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      }, {} as Record<string, string>)
    ).toString()}`
    : "";

  const url = `${envs.PROXY_BASE_URL}/projects/${envs.PROJECT_ID}/sdk/proxy/${args.integration}`;

  const response = await fetch(url, {
    method: args.httpMethod,
    body:
      args.httpMethod.toUpperCase() === "GET"
        ? undefined
        : JSON.stringify(args.body),
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "X-Paragon-Proxy-Url": `${args.url}${queryStr}`,
      ...(args.integration === "slack"
        ? { "X-Paragon-Use-Slack-Token-Type": "user" }
        : {}),
      ...args.headers,
    },
  });

  await handleResponseErrors(response);

  return await response.text();
}
