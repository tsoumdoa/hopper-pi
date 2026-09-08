import { expect, it, vi } from "vitest";
import { RuntimeSessionContext } from "../infra/runtime-session-context.js";
import type { RuntimeRpc } from "../infra/runtime-rpc.js";
import { getCachedOrFetchComponents } from "./canvas-fetch.js";

it("keeps component catalogs from different Rhino installations separate", async () => {
	function installation(name: string) {
		const catalog = { components: [{ name }] };
		const runtime = {
			connect: vi.fn(async () => {}),
			request: vi.fn(async () => catalog),
			ensureGrasshopperReady: vi.fn(async () => {}),
		};
		const session = new RuntimeSessionContext({ createRuntime: () => runtime as unknown as RuntimeRpc });
		return { catalog, runtime, fetch: () => session.run(getCachedOrFetchComponents) };
	}
	const a = installation("Plugin A"), b = installation("Plugin B");
	const [firstA, firstB] = await Promise.all([a.fetch(), b.fetch()]);
	expect(firstA).toBe(a.catalog);
	expect(firstB).toBe(b.catalog);
	expect(await a.fetch()).toBe(a.catalog);
	expect(await b.fetch()).toBe(b.catalog);
	expect(a.runtime.request).toHaveBeenCalledTimes(1);
	expect(b.runtime.request).toHaveBeenCalledTimes(1);
	expect(a.runtime.ensureGrasshopperReady).toHaveBeenCalledTimes(1);
	expect(b.runtime.ensureGrasshopperReady).toHaveBeenCalledTimes(1);
});
