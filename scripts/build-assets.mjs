#!/usr/bin/env node
// Compile host and web assets for development and Rhino packaging.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dev = process.argv.includes("--dev");
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
for (const [entry, ...args] of [
	["typescript/bin/tsc", "-p", "tsconfig.release.json", ...(dev ? ["--sourceMap", "true"] : [])],
	["typescript/bin/tsc", "-p", "tsconfig.web.json"],
	["vite/bin/vite.js", "build", ...(dev ? ["--sourcemap"] : [])],
]) {
	const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../node_modules/${entry}`, import.meta.url)), ...args], {
		cwd: root,
		stdio: "inherit",
	});
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) process.exit(result.status ?? 1);
}
