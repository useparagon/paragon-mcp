				import worker, * as OTHER_EXPORTS from "/workspace/worker/src/index.ts";
				import * as __MIDDLEWARE_0__ from "/workspace/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts";
import * as __MIDDLEWARE_1__ from "/workspace/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts";

				export * from "/workspace/worker/src/index.ts";

				export const __INTERNAL_WRANGLER_MIDDLEWARE__ = [
					
					__MIDDLEWARE_0__.default,__MIDDLEWARE_1__.default
				]
				export default worker;