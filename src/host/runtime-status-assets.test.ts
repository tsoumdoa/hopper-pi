import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser runtime status view", () => {
	it("includes the authoritative runtime fields and authenticated snapshot request", async () => {
		const [app, hook] = await Promise.all([
			readFile(new URL("../../web/src/app.tsx", import.meta.url), "utf8"),
			readFile(new URL("../../web/src/hooks/use-runtime-status.ts", import.meta.url), "utf8"),
		]);
		expect(hook).toContain('fetch("/api/runtime-status"');
		expect(hook).toContain("Authorization: `Bearer ${token}`");
		expect(app).toContain("host?.healthFailureCount");
		expect(app).toContain("Object.entries((status.errors");
	});
});
