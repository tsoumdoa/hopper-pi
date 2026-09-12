import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { bundleRhinoDependencies, DEPENDENCY_BUNDLES } from "./bundle-rhino-dependencies.mjs";

const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const coreRoot = dirname(require.resolve("@earendil-works/pi-agent-core/package.json"));
const typeboxRoot = resolve(dirname(require.resolve("typebox")), "..");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "hopper-dependency-bundle-"));
	roots.push(root);
	const modules = join(root, "node_modules");
	await mkdir(join(modules, "@earendil-works"), { recursive: true });
	await cp(typeboxRoot, join(modules, "typebox"), { recursive: true });
	await cp(coreRoot, join(modules, "@earendil-works/pi-agent-core"), { recursive: true });
	const manifest = JSON.parse(await readFile(join(coreRoot, "package.json"), "utf8"));
	for (const dependency of Object.keys(manifest.dependencies)) {
		if (dependency !== "typebox") await symlink(resolve(coreRoot, "../..", dependency), join(modules, dependency), "junction");
	}
	return modules;
}

// Bundles and imports the full dependency graph; allow for concurrent CI I/O.
it("preserves public exports and shared schema/agent state across bundled entrypoints", async () => {
	const modules = await fixture();
	const exportsBefore = new Map<string, string[]>();
	for (const rule of DEPENDENCY_BUNDLES) {
		const original = rule.name === "typebox" ? typeboxRoot : coreRoot;
		for (const path of Object.values(rule.entries)) {
			const module = await import(/* @vite-ignore */ pathToFileURL(join(original, rule.directory, `${path}${rule.extension}`)).href);
			exportsBefore.set(`${rule.name}/${path}`, Object.keys(module).sort());
		}
	}
	await bundleRhinoDependencies(modules);
	const loaded = new Map<string, any>();
	for (const rule of DEPENDENCY_BUNDLES) {
		for (const path of Object.values(rule.entries)) {
			const module = await import(/* @vite-ignore */ pathToFileURL(join(modules, rule.name, rule.directory, `${path}${rule.extension}`)).href);
			expect(Object.keys(module).sort()).toEqual(exportsBefore.get(`${rule.name}/${path}`));
			loaded.set(`${rule.name}/${path}`, module);
		}
	}
	const { Type } = loaded.get("typebox/index");
	const { Format } = loaded.get("typebox/format/index");
	const { Value } = loaded.get("typebox/value/index");
	const { Compile } = loaded.get("typebox/compile/index");
	Format.Set("hopper-bundle-test", (value: string) => value === "accepted");
	try {
		const schema = Type.String({ format: "hopper-bundle-test" });
		const compiled = Compile(schema);
		expect(Value.Check(schema, "accepted")).toBe(true);
		expect(Value.Check(schema, "rejected")).toBe(false);
		expect(compiled.Check("accepted")).toBe(true);
		expect(compiled.Check("rejected")).toBe(false);
	} finally { Format.Reset(); }
	const core = loaded.get("@earendil-works/pi-agent-core/index");
	expect(loaded.get("@earendil-works/pi-agent-core/node").Agent).toBe(core.Agent);
	expect(loaded.get("@earendil-works/pi-agent-core/harness/context").BACKGROUND_CONTEXT).toBe(core.BACKGROUND_CONTEXT);
}, 30_000);

it.each(["version", "exports"])("rejects changed %s before replacing either package", async field => {
	const modules = await fixture();
	const manifestPath = join(modules, "@earendil-works/pi-agent-core/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (field === "version") manifest.version = "0.86.0";
	else manifest.exports["./new-entry"] = { import: "./dist/new-entry.js" };
	await writeFile(manifestPath, JSON.stringify(manifest));
	const entry = join(modules, "typebox/build/index.mjs");
	const before = await readFile(entry, "utf8");
	await expect(bundleRhinoDependencies(modules)).rejects.toThrow("Review dependency bundling");
	expect(await readFile(entry, "utf8")).toBe(before);
});
