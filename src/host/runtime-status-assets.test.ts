import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser runtime status view", () => {
	it("includes the authoritative runtime fields and authenticated snapshot request", async () => {
		const [html, script] = await Promise.all([
			readFile(new URL("./static/index.html", import.meta.url), "utf8"),
			readFile(new URL("./static/app.js", import.meta.url), "utf8"),
		]);
		for (const id of [
			"runtime-lifecycle",
			"runtime-transport",
			"runtime-instance",
			"runtime-host",
			"runtime-rhino-document",
			"runtime-grasshopper",
			"runtime-grasshopper-document",
			"runtime-dispatcher",
			"runtime-error-list",
		]) {
			expect(html).toContain(`id="${id}"`);
		}
		expect(script).toContain('fetch("/api/runtime-status"');
		expect(script).toContain("Authorization: `Bearer ${state.token}`");
		expect(script).toContain("status.host.healthFailureCount");
		expect(script).toContain("Object.entries(status.errors)");
	});
});
