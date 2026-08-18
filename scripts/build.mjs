import { chmodSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

if (dirname(dist) !== root || !dist.endsWith("/dist")) {
	throw new Error("Refusing to clean an unexpected build directory");
}

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json")], {
	cwd: root,
	stdio: "inherit",
});
chmodSync(join(dist, "cli", "main.js"), 0o755);
