import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Pi publishes a complete bundled SDK alongside the unbundled SDK Hopper imports.
// Retain the public entry paths, but share the unbundled implementation. Keep the
// original SDK, native binaries, image worker, WASM, themes, docs and templates.
export async function deduplicatePiBundle(nodeModules) {
	const root = join(nodeModules, "@earendil-works/pi-coding-agent");
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	if (manifest.version !== "0.85.1") {
		throw new Error(`Review Pi bundle deduplication for version ${manifest.version} before packaging`);
	}
	const bundle = join(root, "dist/bundle");
	const expected = ["chunks", "cli.js", "index.js", "rpc-entry.js"];
	const actual = (await readdir(bundle)).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Unexpected Pi bundle files: ${actual.join(", ")}`);
	}
	// Check all replacement targets before removing any bundled code.
	for (const name of ["cli.js", "index.js", "rpc-entry.js"]) {
		await readFile(join(root, "dist", name), "utf8");
	}
	for (const name of ["cli.js", "rpc-entry.js"]) {
		await writeFile(join(bundle, name), `#!/usr/bin/env node\nimport "../${name}";\n`);
	}
	await writeFile(join(bundle, "index.js"), 'export * from "../index.js";\n');
	await rm(join(bundle, "chunks"), { recursive: true });
}
