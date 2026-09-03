import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser runtime status view", () => {
	it("includes the authoritative runtime fields and authenticated snapshot request", async () => {
		const [statusView, hook] = await Promise.all([
			readFile(new URL("../../web/src/components/runtime-status.tsx", import.meta.url), "utf8"),
			readFile(new URL("../../web/src/hooks/use-runtime-status.ts", import.meta.url), "utf8"),
		]);
		expect(hook).toContain('fetch("/api/runtime-status"');
		expect(hook).toContain("Authorization: `Bearer ${token}`");
		expect(statusView).toContain("host?.healthFailureCount");
		expect(statusView).toMatch(/Object\.entries\(\s*\(status\?\.errors/);
	});
});
