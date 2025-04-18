import Ajv from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { JsonResponseError, UserNotConnectedError } from "./errors";
import { ExtendedTool, TransportPayload } from "./type";
import { decodeJwt, generateSetupLink, performAction, getTools } from "./utils";

const ajv = new Ajv({ allErrors: true, strict: false });

export function registerTools({
  server,
  tools,
  transports,
}: {
  server: Server;
  tools: Array<ExtendedTool>;
  transports: Record<string, TransportPayload>;
}) {
  const toolsList = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  server.registerCapabilities({
    tools: {
      listChanged: true,
    },
  });

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_params, { sessionId }) => {
      if (!sessionId || !transports[sessionId]) {
        throw new Error(`No session found by ID: ${sessionId}`);
      }
      const sessionData = transports[sessionId];

      if (sessionData.cachedTools) {
        return { tools: sessionData.cachedTools };
      }
      const dynamicTools = await getTools(sessionData.currentJwt);
      transports[sessionId].cachedTools = dynamicTools;
      return { tools: dynamicTools };
    }
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, { sessionId }) => {
      if (!sessionId || !transports[sessionId]) {
        throw new Error(`No session found by ID: ${sessionId}`);
      }
      const { name, arguments: args } = request.params;
      const sessionData = transports[sessionId];
      if (!sessionData.cachedTools) {
        sessionData.cachedTools = await getTools(sessionData.currentJwt);
      }
      const dynamicTools = sessionData.cachedTools;
      const tool = dynamicTools.find((t) => t.name === name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      try {
        const validate = ajv.compile(tool.inputSchema);
        const valid = validate(args);

        if (!valid) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Validation error",
                  details: validate.errors,
                }),
              },
            ],
            isError: true,
          };
        }

        const response = await performAction(
          tool.name,
          args,
          transports[sessionId].currentJwt
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
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
        };
      } catch (error: any | JsonResponseError | UserNotConnectedError) {
        if (error instanceof UserNotConnectedError) {
          let setupUrl;
          try {
            let userId = decodeJwt(transports[sessionId!].currentJwt)?.payload
              .sub as string;
            if (!userId) {
              throw new Error("User ID not found");
            }
            setupUrl = await generateSetupLink({
              ...error.jsonResponse.meta,
              integrationName: tool.integrationName,
              userId,
            });

            return {
              content: [
                {
                  type: "text",
                  text: "The integration is not enabled for the user. To set it up, the user will need to visit:",
                },
                {
                  type: "text",
                  text: `${setupUrl}`,
                },
                {
                  type: "text",
                  text: `Instruct the user to set up their ${tool.integrationName} integration by visiting the link. Format the setup link in Markdown.`,
                },
              ],
              isError: true,
            };
          } catch (generateError) {
            error = generateError;
          }
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
    }
  );
}
