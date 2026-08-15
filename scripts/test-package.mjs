import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "hopper-package-"));
const env = { ...process.env, HOPPER_SKIP_GH_PLUGIN: "1" };

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? root,
		encoding: "utf8",
		timeout: options.timeout ?? 180_000,
		env,
	});
	assert.equal(result.error, undefined, result.error?.message);
	assert.equal(result.signal, null, `${command} ${args.join(" ")} was killed (${result.signal})`);
	assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
	return result.stdout;
}

try {
	const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp]));
	assert.equal(packed.length, 1);
	const entry = packed[0];
	const paths = entry.files.map((file) => file.path);
	for (const required of [
		"dist/mcp/stdio.js",
		"package.json",
		"README.md",
		"LICENSE",
		"src/pi/index.ts",
		"scripts/install-grasshopper-plugin.mjs",
		"docs/mcp-migration.md",
		"examples/mcp/codex.toml",
		"examples/mcp/claude-code.mcp.json",
	]) assert.ok(paths.includes(required), `packed tarball is missing ${required}`);
	assert.ok(!paths.some((path) => path.includes(".test.") || path.startsWith(".github/")));

	const tarball = join(temp, entry.filename);
	writeFileSync(join(temp, "package.json"), "{}\n");
	run("npm", ["install", "--no-package-lock", tarball], { cwd: temp });
	const suffix = process.platform === "win32" ? ".cmd" : "";
	const installedBin = join(temp, "node_modules", ".bin", `hopper-mcp${suffix}`);
	assert.ok(existsSync(installedBin), "npm did not link the hopper-mcp executable");
	const badFlag = spawnSync(installedBin, ["--not-a-hopper-option"], {
		cwd: temp,
		encoding: "utf8",
		timeout: 10_000,
		env,
	});
	assert.equal(badFlag.status, 1, `installed hopper-mcp did not reject an unknown option:\n${badFlag.stderr}`);
	assert.match(badFlag.stderr, /Unknown argument: --not-a-hopper-option/);

	// Run outside the source tree so missing files and undeclared dependencies cannot hide.
	const inspectorOutput = run(process.execPath, [resolve(root, "scripts/test-mcp-inspector.mjs"), "--bin", installedBin], {
		cwd: temp,
		timeout: 90_000,
	});
	process.stdout.write(inspectorOutput);
	console.log(`Clean package install verified: ${entry.filename}`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
