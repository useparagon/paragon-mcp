export interface Env {
	MCP_CONTAINER?: {
		fetch: (request: Request) => Promise<Response>;
	};
	LOCAL_UPSTREAM?: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		// If the Cloudflare Container binding is available (in prod), forward to it directly
		if (env.MCP_CONTAINER && typeof env.MCP_CONTAINER.fetch === "function") {
			return env.MCP_CONTAINER.fetch(request);
		}

		// Fallback for `wrangler dev`: proxy to a locally running server (e.g., via `docker compose up`)
		const upstreamBase = env.LOCAL_UPSTREAM || "http://127.0.0.1:3001";
		const upstreamUrl = new URL(url.pathname + url.search, upstreamBase);

		return fetch(new Request(upstreamUrl.toString(), request));
	},
};