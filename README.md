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
- `NODE_ENV`: Node environment (default: development)

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
      "url": "http://localhost:3001/sse?user=connected-user"
    }
  }
}
```

Replace:

- `http://localhost:3001` with your server's domain
- `connected-user` with your desired display name for the Connected User

### Claude

To use this MCP server with Claude, add the following to your Claude configuration file at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "actionkit": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/sse?user=connected-user"]
    }
  }
}
```

Replace:

- `http://localhost:3001` with your server's domain
- `connected-user` with your desired display name for the Connected User

## API Endpoints

- `GET /sse`: Establishes SSE connection for MCP communication
- `POST /messages`: Handles MCP message processing
- `GET /setup`: Handles integration setup flow

## License

This project is open source and available under the [MIT License](https://opensource.org/license/mit).
