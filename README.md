<p align="center">
  <a href="https://www.useparagon.com/" target="blank"><img src="https://raw.githubusercontent.com/useparagon/aws-on-prem/master/assets/paragon-logo-dark.png" width="150" alt="Paragon Logo" /></a>
</p>

<p align="center">
  <b>
    The embedded integration platform for developers.
  </b>
</p>

---

# Paragon MCP Server

A server implementation for Model Context Protocol (MCP) that integrates with Paragon's action system. This is an open-source project that enables developers to build custom integrations with Paragon's platform via ActionKit.

## Prerequisites

To start using the Paragon MCP Server, you will need to [sign up and register for an account](https://dashboard.useparagon.com/signup).

- Node.js @ 22.14.0
- npm package manager

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the root directory with the following variables. You can use `.env.example` as a template:

```env
# Required
PROJECT_ID=your_project_id

# Required (one of these must be set)
SIGNING_KEY=your_signing_key
SIGNING_KEY_PATH=absolute_path_to_signing_key_file

# Required for production
MCP_SERVER_URL=your_public_url_for_this_mcp_server

# Optional
PORT=3001
CONNECT_SDK_CDN_URL=https://cdn.useparagon.com/latest/sdk/index.js
ACTION_KIT_BASE_URL=https://actionkit.useparagon.com
NODE_ENV=development
```

### Environment Variables Description

- `PROJECT_ID`: Your Paragon project ID (required)
- `SIGNING_KEY`: Your JWT signing key (required if SIGNING_KEY_PATH is not set)
- `SIGNING_KEY_PATH`: Path to your JWT signing key file (required if SIGNING_KEY is not set)
- `PORT`: Server port (default: 3001)
- `MCP_SERVER_URL`: # The url of where your MCP Server will be hosted; This will be used to generate the magic links for your users, and also to setup your AI agents
- `CONNECT_SDK_CDN_URL`: Paragon Connect SDK CDN URL (default: https://cdn.useparagon.com/latest/sdk/index.js)
- `ACTION_KIT_BASE_URL`: Paragon ActionKit base URL (default: https://actionkit.useparagon.com)
- `NODE_ENV`: Node environment (default: `development`)
  <sub>**Note**: When `NODE_ENV` is set to `development`, the `/sse` parameter accepts any user ID in the `?user=` query parameter to automatically authorize as a specific user while testing locally.</sub>

## Running the Server

Start the server using:

```bash
npm run start
```

The server will start on `http://localhost:3001` by default.

## Client Configuration

> **Note:** Cursor's MCP implementation is a very new protocol and is still in active development. You might encounter unexpected issues. When making changes to the MCP server URL, a full client restart is recommended. For more information about current limitations, see the [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol#limitations).

### Cursor

To use this MCP server with Cursor, add the following to your Cursor configuration file at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-actionkit-dev": {
      "url": "http://localhost:3001/sse?user=[user-id]"
    }
  }
}
```

Replace:

- `http://localhost:3001` with your server's domain
- `user-id` with the ID for the Connected User to use with ActionKit (this parameter only available in development mode)

### Claude

To use this MCP server with Claude, add the following to your Claude configuration file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "actionkit": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/sse?user=[user-id]"]
    }
  }
}
```

Replace:

- `http://localhost:3001` with your server's domain
- `user-id` with the ID for the Connected User to use with ActionKit (this parameter only available in development mode)

## API Endpoints

- `GET /sse`: Establishes SSE connection for MCP communication
  - This endpoint accepts an Authorization header with a Paragon User Token as the Bearer token.
- `POST /messages`: Handles MCP message processing
- `GET /setup`: Handles integration setup flow

## Adding Custom Actions with OpenAPI

To add your own Custom Action definitions:

1. Set `ENABLE_CUSTOM_OPENAPI_ACTIONS=true` in your environment (e.g. .env file).
2. Create an `openapi/` subfolder at the root of the repository.
3. Add OpenAPI specs in YAML or JSON format, using the integration name as the file name.
    - For example, if you are adding Custom Actions for Google Calendar, the OpenAPI specs should be located at: `openapi/googleCalendar.json`.
    - If you are adding Actions for a Custom Integration, use the SDK name of the integration, with the `custom.` prefix: `openapi/custom.spotify.json`.

The MCP will automatically match OpenAPI files with Active integrations in your Paragon project to augment the list of available tools returned by the MCP.

## License

This project is open source and available under the [MIT License](https://opensource.org/license/mit).
