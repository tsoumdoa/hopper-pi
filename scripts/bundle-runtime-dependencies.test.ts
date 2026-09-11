import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { bundleRuntimeDependencies } from "./bundle-runtime-dependencies.mjs";

const requirePi = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const source = resolve(dirname(requirePi.resolve("typebox")), "..");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "hopper-runtime-bundle-"));
	roots.push(root);
	await cp(source, join(root, "typebox"), { recursive: true });
	return root;
}

it("reduces file loading while preserving public exports, the license, and the shared format registry", async () => {
	const root = await fixture();
	const packageRoot = join(root, "typebox");
	const manifestBefore = await readFile(join(packageRoot, "package.json"), "utf8");
	const licenseBefore = await readFile(join(packageRoot, "license"), "utf8");
	const report = await bundleRuntimeDependencies(root);
	expect(report.after.files).toBeLessThan(30);
	expect(report.before.files).toBeGreaterThan(600);
	expect(report.after.bytes).toBeLessThan(report.before.bytes);
	expect(await readFile(join(packageRoot, "package.json"), "utf8")).toBe(manifestBefore);
	expect(await readFile(join(packageRoot, "license"), "utf8")).toBe(licenseBefore);
	const bundled: Record<string, any> = {};
	for (const [name, entry] of Object.entries(JSON.parse(manifestBefore).exports) as [string, { import: string }][]) {
		const original = await import(pathToFileURL(resolve(source, entry.import)).href);
		bundled[name] = await import(pathToFileURL(resolve(packageRoot, entry.import)).href);
		expect(Object.keys(bundled[name]).sort()).toEqual(Object.keys(original).sort());
	}
	const schema = bundled["."].Type.String({ format: "hopper-shared" });
	bundled["./format"].Set("hopper-shared", (value: string) => value === "accepted");
	expect(bundled["./value"].Check(schema, "accepted")).toBe(true);
	expect(bundled["./value"].Check(schema, "rejected")).toBe(false);
	const validator = bundled["./compile"].Compile(schema);
	expect(validator.Check("accepted")).toBe(true);
	expect(validator.Check("rejected")).toBe(false);
	expect(bundled["./schema"].Check({}, schema, "rejected")).toBe(false);
}, 20_000);

it.each(["version", "exports"])("rejects changed %s before writing files", async field => {
	const root = await fixture();
	const manifestPath = join(root, "typebox/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (field === "version") manifest.version = "2.0.0";
	else manifest.exports["./new"] = { import: "./build/index.mjs" };
	await writeFile(manifestPath, JSON.stringify(manifest));
	const original = await readFile(join(root, "typebox/build/index.mjs"), "utf8");
	await expect(bundleRuntimeDependencies(root)).rejects.toThrow("Review");
	expect(await readFile(join(root, "typebox/build/index.mjs"), "utf8")).toBe(original);
});

it("refuses to modify the development installation", async () => {
	await expect(bundleRuntimeDependencies(resolve("node_modules"))).rejects.toThrow("development node_modules");
});
