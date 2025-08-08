import { ExtendedTool } from "./type";
import { envs } from "./utils";
import { handleResponseErrors } from "./utils";
// @ts-ignore
import { markdown } from 'markdown';
// @ts-ignore
import { HTMLToJSON } from 'html-to-json-parser';

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

async function performCustomNotionCreate(
  actionParams: any,
  jwt: string
) {
  console.log(`DEBUG:`, "Running custom notion action", actionParams);
  const children = await markdownToJson(actionParams.content);
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
          children: children,
        }
      }),
    });
    await handleResponseErrors(response);
    return await response.json();
  } catch (error) {
    throw error;
  }
}

async function markdownToJson(markdownString: string) {
  const html = markdown.toHTML(markdownString);
  const json = await HTMLToJSON(`<div> ${html} </div>`);
  const result = [];
  for (const block of json.content) {
    const notionBlock = toNotionBlock(block);
    if (notionBlock) {
      result.push(notionBlock);
    }
  }
  return result;
}

//NOTE: for full list of notion block types
//https://developers.notion.com/reference/block#block-type-objects
function toNotionBlock(block: any) {
  let result = null;
  if (typeof block === 'object') {
    if (block.type === 'p') {
      result = {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: block.content[0]
              }
            }
          ]
        }
      };
    } else if (block.type === 'h1') {
      result = {
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [
            {
              type: "text",
              text: {
                content: block.content[0]
              }
            }
          ]
        }
      };
    } else if (block.type === 'h2') {
      result = {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [
            {
              type: "text",
              text: {
                content: block.content[0]
              }
            }
          ]
        }
      };
    } else if (block.type === 'h3') {
      result = {
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [
            {
              type: "text",
              text: {
                content: block.content[0]
              }
            }
          ]
        }
      };
    }
  }
  return result;
}
