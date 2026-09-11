#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { runs: { type: "string", default: "3" }, module: { type: "string", default: "@earendil-works/pi-coding-agent" } },
});
if (positionals.length !== 1) throw new Error("Usage: node scripts/profile-runtime-imports.mjs <runtime/host-directory> [--runs 3] [--module package-name]");
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100) throw new Error("--runs must be between 1 and 100");
const hostDirectory = resolve(positionals[0]);

// Each measurement gets a fresh Node process. OS file caches remain warm on
// repeat runs. Collect the import graph separately so hooks don't bias timing.
function probe(trace) {
	const source = `
import { registerHooks } from "node:module";
const packages = new Map();
let resolutions = 0;
const nativeLoads = [];
if (${trace}) {
	const dlopen = process.dlopen;
	process.dlopen = function(...args) {
		const start = performance.now();
		try { return dlopen.apply(this, args); }
		finally { nativeLoads.push({ file: String(args[1]).replaceAll("\\\\", "/").split("/node_modules/").at(-1), ms: performance.now() - start }); }
	};
	registerHooks({
		resolve(specifier, context, next) { resolutions++; return next(specifier, context); },
		load(url, context, next) {
			const result = next(url, context);
			if (url.startsWith("file:")) {
				const path = url.split("/node_modules/").at(-1);
				const name = path.startsWith("@") ? path.split("/").slice(0, 2).join("/") : path.split("/")[0];
				packages.set(name, (packages.get(name) ?? 0) + 1);
			}
			return result;
		},
	});
}
const cpu = process.cpuUsage(), start = performance.now();
await import(${JSON.stringify(values.module)});
const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu);
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
	elapsedMs, cpuMs: (used.user + used.system) / 1000,
	...(${trace} ? { resolutions, files: [...packages.values()].reduce((a, b) => a + b, 0),
		packages: Object.fromEntries([...packages].sort((a, b) => b[1] - a[1])), nativeLoads } : {}) }));
`;
	const child = spawnSync(process.env.HOPPER_NODE_EXECUTABLE || process.execPath, ["--input-type=module", "--eval", source], {
		cwd: hostDirectory, encoding: "utf8", timeout: 60_000,
		env: { ...process.env, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
	});
	if (child.error || child.status !== 0) throw new Error(`Import probe failed: ${child.error?.message ?? child.stderr}`);
	return JSON.parse(child.stdout);
}

const timings = Array.from({ length: runs }, () => probe(false));
console.log(JSON.stringify({ module: values.module, timings, graph: probe(true) }, null, 2));
