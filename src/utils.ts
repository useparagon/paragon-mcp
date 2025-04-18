import { z } from "zod";
import jwt from "jsonwebtoken";
import fs from "fs";

import { UserNotConnectedError } from "./errors";
import { ExtendedTool, LinkConnectionProps } from "./type";
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
    CONNECT_SDK_CDN_URL: z
      .string()
      .default("https://cdn.useparagon.com/latest/sdk/index.js"),
    ACTION_KIT_BASE_URL: z.string().default("https://actionkit.useparagon.com"),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    ENABLE_CUSTOM_OPENAPI_ACTIONS: z.boolean({ coerce: true }).default(false),
  })
  .parse(process.env);

export const MCP_SERVER_DOMAIN =
  envs.NODE_ENV === "development"
    ? `${envs.MCP_SERVER_URL}:${envs.PORT}`
    : envs.MCP_SERVER_URL;

export async function getActions(jwt: string): Promise<any | null> {
  try {
    const url = `${envs.ACTION_KIT_BASE_URL}/projects/${envs.PROJECT_ID}/actions?limit_to_available=false`;
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

  const resolvedRequestPath = `${
    request.baseUrl ? `/${request.baseUrl}` : ""
  }${request.path.replace(
    /\{(\w+)\}/g,
    (_match: string, p1: string) => actionParams.params[p1]
  )}`;

  let url;
  if (action.integrationName.startsWith("custom")) {
    url = `https://proxy.useparagon.com/projects/${
      envs.PROJECT_ID
    }/sdk/proxy/custom/${action.integrationId!}${resolvedRequestPath}`;
  } else {
    url = `https://proxy.useparagon.com/projects/${envs.PROJECT_ID}/sdk/proxy/${action.integrationName}/${resolvedRequestPath}`;
  }
  const urlParams = new URLSearchParams(
    request.params
      .filter((param) => param.in === "query")
      .map((param) => [param.name, actionParams.params[param.name]])
  );
  url += `?${urlParams.toString()}`;

  console.log(url);
  const response = await fetch(url, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body:
      request.method.toLowerCase() === OpenAPIV3.HttpMethods.GET
        ? undefined
        : JSON.stringify(actionParams),
  });
  await handleResponseErrors(response);
  return await response.json();
}

export async function performAction(
  actionName: string,
  actionParams: any,
  jwt: string
): Promise<any | null> {
  console.log(`DEBUG:`, "Running action", actionName, actionParams);
  try {
    const url = `${envs.ACTION_KIT_BASE_URL}/projects/${envs.PROJECT_ID}/actions`;
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

export async function getTools(jwt: string): Promise<Array<any>> {
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

export const zodParser = ({
  property,
  isRequired,
}: {
  property: any;
  isRequired: boolean;
}) => {
  let zodType;

  switch (property.type) {
    case "string":
      zodType = z.string({ description: property.description });
    case "number":
      zodType = z.number({ description: property.description });
    case "boolean":
      zodType = z.boolean({ description: property.description });
    default:
      zodType = z.string({ description: property.description });
  }

  if (!isRequired) {
    return zodType.optional();
  }

  return zodType;
};

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
      `https://zeus.useparagon.com/projects/${envs.PROJECT_ID}/sdk/integrations`,
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
