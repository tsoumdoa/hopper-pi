#!/usr/bin/env node

import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildRhinoHost(outputDirectory, reportPath) {
	const result = await build({
		absWorkingDir: packageRoot,
		entryPoints: {
			index: "src/host/index.ts",
			"shared/journal": "src/host/shared/journal.ts",
			"runtime-paths": "src/host/runtime-paths.ts",
		},
		outdir: resolve(outputDirectory, "host"),
		bundle: true,
		splitting: true,
		platform: "node",
		target: "node22.19",
		format: "esm",
		// Pi's extension loader exposes entire module namespaces and loads workers,
		// native bindings and assets relative to the original package locations.
		// Audited dependency trees are bundled in place by bundle-rhino-dependencies.
		packages: "external",
		minify: true,
		keepNames: true,
		sourcemap: false,
		metafile: true,
		legalComments: "eof",
		// runtime-paths uses import.meta.url. Keep shared code and dynamic entries
		// next to index.js so its project root stays correct after code splitting.
		chunkNames: "[name]-[hash]",
	});
	if (reportPath) {
		await mkdir(dirname(resolve(reportPath)), { recursive: true });
		await writeFile(reportPath, `${JSON.stringify(result.metafile, null, 2)}\n`);
	}
	return result.metafile;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const args = process.argv.slice(2);
	const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
	const output = option("--output") ?? resolve(packageRoot, "artifacts/rhino-host/dist");
	await buildRhinoHost(output, option("--report"));
	console.log(`[hopper-pi] Bundled Rhino host at ${resolve(output)}`);
}
