import { Container } from "@cloudflare/containers";

export class MCPContainer extends Container {
	defaultPort = 3001;
}

export interface Env {
	MCP_CONTAINER?: DurableObjectNamespace;
	LOCAL_UPSTREAM?: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		// Prefer routing to the Cloudflare Container in production
		if (env.MCP_CONTAINER) {
			const id = env.MCP_CONTAINER.idFromName("default");
			const instance = env.MCP_CONTAINER.get(id);
			return instance.fetch(request);
		}

		// Fallback for local dev: proxy to a locally running server
		const upstreamBase = env.LOCAL_UPSTREAM || "http://127.0.0.1:3001";
		const upstreamUrl = new URL(url.pathname + url.search, upstreamBase);
		return fetch(new Request(upstreamUrl.toString(), request));
	},
};