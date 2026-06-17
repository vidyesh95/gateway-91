import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		BOT_TOKEN: string;
		WEBHOOK_SECRET: string;
	}
}

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("gateway-91 worker", () => {
	it("returns ok on GET / (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("gateway-91 ok");
	});

	it("returns ok on GET / (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("gateway-91 ok");
	});

	it("returns 404 for unknown paths", async () => {
		const response = await SELF.fetch("https://example.com/nope");
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not found");
	});
});
