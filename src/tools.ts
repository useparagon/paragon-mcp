import { ZodRawShape, z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { JsonResponseError, UserNotConnectedError } from "./errors";
import { ExtendedTool, TransportPayload } from "./type";
import { generateSetupLink, performAction, zodParser } from "./utils";

function parseSchemaRecursively(property: any, isRequired: boolean): any {
  if (property.type === "array" && property.items) {
    const itemSchema = parseSchemaRecursively(property.items, true);
    const arraySchema = z.array(itemSchema, {
      description: property.description,
    });
    return isRequired ? arraySchema : arraySchema.optional();
  }

  if (property.type === "object" && property.properties) {
    const shape: ZodRawShape = {};
    for (const key in property.properties) {
      const isPropertyRequired = property.required?.includes(key) ?? false;
      shape[key] = parseSchemaRecursively(
        property.properties[key],
        isPropertyRequired,
      );
    }
    const schema = z.object(shape, { description: property.description });
    return isRequired ? schema : schema.optional();
  }

  return zodParser({ property: property, isRequired });
}

export function registerTools({
  server,
  tools,
  transports,
}: {
  server: McpServer;
  tools: Array<ExtendedTool>;
  transports: Record<string, TransportPayload>;
}) {
  for (const tool of tools) {
    const zodParams: ZodRawShape = {};
    for (const key in tool.inputSchema.properties) {
      const property = tool.inputSchema.properties[key] as any;
      zodParams[key] = parseSchemaRecursively(
        property,
        tool.requiredFields.includes(key),
      );
    }

    server.tool(
      tool.name,
      tool.description +
        "If there is an error related to the integration not being enabled for the user, please answer with the given URL as a link." +
        "Whenever there is a setup URL in the answer, format it as a link, never ask for confirmation, just give me a formatted link in the following text `{Integration Name} Setup Link`. Always give a formatted link",
      zodParams,
      async (args, rest) => {
        try {
          const response = await performAction(
            tool.name,
            args,
            transports[rest.sessionId!!].currentJwt,
          );

          if (response === null) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Failed to execute tool: ${tool.name}`,
                  }),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(response) },
            ],
          };
        } catch (error: any | JsonResponseError | UserNotConnectedError) {
          if (error instanceof UserNotConnectedError) {
            const setupUrl = await generateSetupLink({
              ...error.jsonResponse.meta,
              integrationName: tool.integrationName,
              userId: error.jsonResponse.meta.endUserId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: "The integration is not enabled for the user. To set it up go to:",
                },
                {
                  type: "text",
                  text: `${setupUrl}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: error.message,
                }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
