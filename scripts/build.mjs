#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
let options;
try {
	({ values: options } = parseArgs({
		args: process.argv.slice(2).filter((arg) => arg !== "--"),
		options: {
			dev: { type: "boolean" },
			target: { type: "string" },
			output: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	}));
	if (options.dev && (options.target || options.output)) {
		throw new Error("--dev writes host and UI assets to dist; it cannot be combined with --target or --output.");
	}
	if (options.target && !["mac-arm64", "win-x64"].includes(options.target)) {
		throw new Error("--target must be mac-arm64 or win-x64.");
	}
} catch (error) {
	console.error(error.message);
	process.exit(1);
}

if (options.help) {
	console.log(`Usage: pnpm build [options]

  (no flags)       Build verified macOS arm64 and Windows x64 Yak packages
  --dev           Compile host and UI with source maps into dist, without Yak
  --target <name>  Build mac-arm64 or win-x64 only
  --output <dir>   Package destination; each target gets a subfolder unless --target is set
  --help          Show this help`);
	process.exit(0);
}

function run(script, args) {
	const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
		cwd: root,
		stdio: "inherit",
	});
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (options.dev) {
	run("./build-assets.mjs", ["--dev"]);
} else {
	for (const target of options.target ? [options.target] : ["mac-arm64", "win-x64"]) {
		const args = ["--yak"];
		if (target) args.push("--target", target);
		if (options.output) args.push("--output", options.target ? options.output : resolve(root, options.output, target));
		run("./package-rhino.mjs", args);
	}
}
