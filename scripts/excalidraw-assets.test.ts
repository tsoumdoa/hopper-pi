import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { expect, test } from "vitest";
import { build } from "vite";

test("production editor keeps English controls and every drawing font without duplicate CSS fonts", async () => {
	const result = await build({
		configFile: resolve("vite.config.ts"),
		logLevel: "silent",
		resolve: { conditions: ["module", "browser", "production"] },
		build: { write: false },
	});
	if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one browser build");
	const chunks = result.output.filter((output) => output.type === "chunk");
	const localeModules = chunks.map((chunk) => (chunk.facadeModuleId ?? "").replaceAll("\\", "/")).filter((id) => /excalidraw\/dist\/prod\/locales\//.test(id));
	expect(localeModules).toHaveLength(1);
	expect(localeModules[0]).toMatch(/\/en-[\w-]+\.js$/);

	const distribution = dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw"));
	const fonts = join(distribution, "fonts");
	const assets = new Map(result.output.filter((output) => output.type === "asset").map((asset) => [asset.fileName, asset.source]));
	let drawingFonts = 0;
	for (const file of readdirSync(fonts, { recursive: true, withFileTypes: true })) {
		if (!file.isFile() || !file.name.endsWith(".woff2")) continue;
		const path = join(file.parentPath, file.name);
		const name = relative(fonts, path).split(sep).join("/");
		const packaged = assets.get(`excalidraw/fonts/${name}`);
		if (name.startsWith("Assistant/")) {
			expect(packaged).toBeUndefined();
			// Assistant remains available through Vite's CSS asset URLs.
			expect([...assets.values()].some((source) => Buffer.from(source).equals(readFileSync(path)))).toBe(true);
		} else {
			expect(packaged, `Missing offline drawing font ${name}`).toBeDefined();
			expect(Buffer.from(packaged!).equals(readFileSync(path)), `Changed drawing font ${name}`).toBe(true);
			drawingFonts++;
		}
	}
	expect(drawingFonts).toBeGreaterThan(200);
	expect(chunks.some((chunk) => chunk.fileName.includes("sequenceDiagram"))).toBe(true);
}, 30_000);
