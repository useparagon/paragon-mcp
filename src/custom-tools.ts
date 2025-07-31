import { ExtendedTool } from "./type";
import { envs } from "./utils";
import { handleResponseErrors } from "./utils";

export function getCustomTools(): Array<ExtendedTool> {
  const customTools: Array<ExtendedTool> = [];
  const notionTool: ExtendedTool = {
    isOpenApiTool: false,
    name: "CUSTOM_NOTION_CREATE_PAGE",
    description: "Use this tool to create a page in Notion",
    inputSchema: {
      type: "object",
      properties: {
        parent: {
          type: "string",
          description: "The parent page id"
        },
        title: {
          type: "string",
          descriptions: "title of the Notion page "
        },
        content: {
          type: "string",
          descriptions: "Contents of the Notion page in markdown format"
        },
      },
    },
    integrationName: "notion",
    requiredFields: ['parent', 'title', 'content']
  };
  customTools.push(notionTool);
  return customTools;
}

export async function performCustomAction(
  actionName: string,
  actionParams: any,
  jwt: string
) {
  if (actionName === "CUSTOM_NOTION_CREATE_PAGE") {
    return await performCustomNotionCreate(actionParams, jwt);
  }
}

export async function performCustomNotionCreate(
  actionParams: any,
  jwt: string
) {
  console.log(`DEBUG:`, "Running custom notion action", actionParams);
  try {
    const url = `${envs.ACTIONKIT_BASE_URL}/projects/${envs.PROJECT_ID}/actions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        action: "NOTION_CREATE_PAGE",
        parameters: {
          parent: { page_id: actionParams.parent },
          properties: { title: [{ text: { content: actionParams.title } }] },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: {
                      content: actionParams.content
                    }
                  }
                ]
              }
            }
          ]
        }
      }),
    });
    await handleResponseErrors(response);
    const res = await response.json();
    return res;
  } catch (error) {
    throw error;
  }

}
