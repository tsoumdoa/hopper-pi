import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildRhinoHost } from "./build-rhino-host.mjs";

let directory: string;
let metadata: Awaited<ReturnType<typeof buildRhinoHost>>;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "hopper-host-bundle-"));
	await writeFile(join(directory, "package.json"), '{"type":"module"}');
	metadata = await buildRhinoHost(join(directory, "dist"));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

it("resolves packaged skills relative to the relocated host, independently of cwd", async () => {
	const { hostProjectRoot } = await import(/* @vite-ignore */ pathToFileURL(join(directory, "dist/host/runtime-paths.js")).href);
	expect(await realpath(hostProjectRoot())).toBe(await realpath(directory));
});

it("keeps Pi and agent session code outside the initial launch graph without duplicating local modules", () => {
	const outputs = metadata.outputs;
	const entry = Object.entries(outputs).find(([, output]) => output.entryPoint === "src/host/index.ts")![0];
	const visited = new Set<string>();
	const initialInputs = new Set<string>();
	const initialPackages = new Set<string>();
	function visit(path: string) {
		if (visited.has(path)) return;
		visited.add(path);
		for (const input of Object.keys(outputs[path].inputs)) initialInputs.add(input);
		for (const imported of outputs[path].imports) {
			if (imported.kind === "dynamic-import") continue;
			if (imported.external) initialPackages.add(imported.path);
			else visit(imported.path);
		}
	}
	visit(entry);
	// The shared HTTP host must also start before Pi session imports run.
	const sharedMain = Object.entries(outputs).find(([, output]) => output.entryPoint === "src/host/shared/main.ts")![0];
	visit(sharedMain);
	expect([...initialPackages].filter(name => name.startsWith("@earendil-works/"))).toEqual([]);
	expect(initialInputs.has("src/host/pi-runtime.ts")).toBe(false);
	expect(initialInputs.has("src/host/shared/pi-driver.ts")).toBe(false);
	for (const singleton of ["src/infra/runtime-session-context.ts", "src/services/tool-policy-context.ts"]) {
		expect(Object.values(outputs).filter(output => singleton in output.inputs)).toHaveLength(1);
	}
	const dynamicEntries = Object.values(outputs).map(output => output.entryPoint);
	expect(dynamicEntries).toContain("src/host/pi-runtime.ts");
	expect(dynamicEntries).toContain("src/host/shared/pi-driver.ts");
});
