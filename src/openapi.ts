import $RefParser, { JSONSchema } from "@apidevtools/json-schema-ref-parser";
import {
  fromParameter,
  fromSchema,
} from "@openapi-contrib/openapi-schema-to-json-schema";
import { readdir, readFile } from "fs/promises";
import { OpenAPIV3_1 } from "openapi-types";
import * as path from "path";
import yaml from "yaml";
import { ExtendedTool, Integration } from "./type";

export const openApiRequests: Record<
  string,
  {
    baseUrl?: string;
    method: OpenAPIV3_1.HttpMethods;
    path: string;
    params: OpenAPIV3_1.ParameterObject[];
  }
> = {};

export async function loadCustomOpenApiTools(
  integrations: Integration[]
): Promise<ExtendedTool[]> {
  let files;
  try {
    files = await readdir(path.join(process.cwd(), "openapi"));
  } catch (err) {
    console.error(
      "Custom OpenAPI tools was enabled, but openapi/ folder was not found",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }

  const findMatchingIntegration = (file: string): Integration | undefined => {
    return integrations.find((integration) => {
      if (integration.type === "custom") {
        return file.includes(
          `custom.${integration
            .customIntegration!.name.split(" ")
            .join("")
            .toLowerCase()}`
        );
      }
      return file.split(".")[0] === integration.type;
    });
  };

  const customOpenApiTools = await Promise.all(
    files
      .filter((file) => findMatchingIntegration(file))
      .map(async (file) => {
        const content = await readFile(
          path.join(process.cwd(), "openapi", file),
          "utf-8"
        );
        const integrationName = file.substring(0, file.lastIndexOf("."));
        const matchingIntegration = findMatchingIntegration(file);

        return {
          integrationName,
          integrationId: matchingIntegration!.id,
          content: (file.endsWith(".yml")
            ? yaml.parse(content)
            : JSON.parse(content)) as OpenAPIV3_1.Document,
        };
      })
  );

  const customTools: ExtendedTool[] = [];

  for (const item of customOpenApiTools) {
    const spec = (await $RefParser.dereference(
      item.content
    )) as OpenAPIV3_1.Document;

    if (spec.paths) {
      const tools = spec.paths;
      for (const tool of Object.keys(tools)) {
        const path = tools[tool]!;
        for (const method of Object.keys(path)) {
          const request = path[method as OpenAPIV3_1.HttpMethods]!;
          const requestParameters = request.parameters as
            | OpenAPIV3_1.ParameterObject[]
            | undefined;
          const requestName = request.summary ?? `${method} ${path}`;
          let paramsSchema;
          let bodySchema;

          if (requestParameters) {
            paramsSchema = {
              type: "object",
              properties: Object.fromEntries(
                requestParameters.map((param) => [
                  param.name,
                  fromParameter(param as any),
                ])
              ),
              required: requestParameters
                .filter((param) => param.required || param.in === "path")
                .map((param) => param.name),
            };
          }
          if (
            request.requestBody &&
            "content" in request.requestBody &&
            "application/json" in request.requestBody.content
          ) {
            bodySchema = fromSchema(
              request.requestBody.content["application/json"]
                .schema as OpenAPIV3_1.SchemaObject
            );
          }

          const requiredFields = [
            ...(Object.keys(paramsSchema?.properties ?? {}).length > 0
              ? ["params"]
              : []),
            ...(Object.keys(bodySchema?.properties ?? {}).length > 0
              ? ["body"]
              : []),
          ];

          const toolName = `${item.integrationName
            .split(".")
            .join("_")
            .toUpperCase()}_${requestName.split(" ").join("_").replace(/(\r\n|\n|\r)/g, "").toUpperCase()}`;

          openApiRequests[toolName] = {
            baseUrl: spec.servers?.[0]?.url,
            method: method as OpenAPIV3_1.HttpMethods,
            path: tool,
            params: request.parameters as OpenAPIV3_1.ParameterObject[],
          };

          customTools.push({
            isOpenApiTool: true,
            integrationName: item.integrationName,
            integrationId: item.integrationId,
            name: toolName,
            description: `${requestName} - ${request.description}`,
            inputSchema: {
              type: "object",
              properties: {
                ...(paramsSchema && { params: paramsSchema }),
                ...(bodySchema && { body: bodySchema }),
              },
              required: requiredFields,
            },
            requiredFields,
          });
        }
      }
    }
  }

  return customTools;
}
