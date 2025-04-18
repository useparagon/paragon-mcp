import $RefParser, { JSONSchema } from "@apidevtools/json-schema-ref-parser";
import {
  fromParameter,
  fromSchema,
} from "@openapi-contrib/openapi-schema-to-json-schema";
import { readdir, readFile } from "fs/promises";
import { OpenAPIV3_1 } from "openapi-types";
import * as path from "path";
import yaml from "yaml";
import { Integration } from "./type";

export async function loadCustomOpenApiTools(
  integrations: Integration[]
): Promise<Record<string, JSONSchema>> {
  const files = await readdir(path.join(process.cwd(), "openapi"));
  const customOpenApiTools = await Promise.all(
    files
      .filter((file) =>
        integrations.find((integration) => {
          if (integration.type === "custom") {
            return file.includes(
              `custom.${integration.customIntegration!}.name
                .split(" ")
                .join("")
                .toLowerCase()}`
            );
          }
          return file.split(".")[0] === integration.type;
        })
      )
      .map(async (file) => {
        const content = await readFile(
          path.join(process.cwd(), "openapi", file),
          "utf-8"
        );
        const integrationName = file.substring(0, file.lastIndexOf("."));
        return {
          integrationName,
          content: (file.endsWith(".yml")
            ? yaml.parse(content)
            : JSON.parse(content)) as OpenAPIV3_1.Document,
        };
      })
  );

  // Convert OpenAPI specs to JSON Schema function definition
  const integrationSpecs: Record<string, Record<string, JSONSchema>> = {};
  for (const item of customOpenApiTools) {
    const spec = (await $RefParser.dereference(
      item.content
    )) as OpenAPIV3_1.Document;
    integrationSpecs[item.integrationName] = {};

    if (spec.paths) {
      const tools = spec.paths;
      for (const tool of Object.keys(tools)) {
        const path = tools[tool]!;
        for (const method of Object.keys(path)) {
          const request = path[method as OpenAPIV3_1.HttpMethods]!;
          const requestParameters = request.parameters as
            | OpenAPIV3_1.ParameterObject[]
            | undefined;
          const requestName =
            request.summary ?? `${method} ${path}`;
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
              required: requestParameters.map((param) => param.name),
            };
          }
          if (request.requestBody) {
            bodySchema = fromSchema(request.requestBody);
          }

          integrationSpecs[item.integrationName][
            requestName.split(" ").join("_").toLowerCase()
          ] = {
            function: {
              name: requestName.split(" ").join("_").toLowerCase(),
              description: `${requestName} - ${request.description}`,
              parameters: {
                type: "object",
                properties: {
                  ...(paramsSchema && { params: paramsSchema }),
                  ...(bodySchema && { body: bodySchema }),
                },
                required: [
                  ...(Object.keys(paramsSchema?.properties ?? {}).length > 0
                    ? ["params"]
                    : []),
                  ...(Object.keys(bodySchema?.properties ?? {}).length > 0
                    ? ["body"]
                    : []),
                ],
              },
            },
          };
        }
      }
    }
  }

  return integrationSpecs;
}
