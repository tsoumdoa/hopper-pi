import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "hopper-yak-test-"));
	temporary.push(dir);
	const log = join(dir, "calls.jsonl");
	const yak = join(dir, "yak");
	writeFileSync(yak, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.YAK_TEST_LOG, JSON.stringify(args) + '\\n');
if (process.env.YAK_TEST_FAIL_PUSH && args[0] === 'push') process.exit(7);
`, { mode: 0o755 });
	function add(target: string, platform: string, direct = false) {
		const folder = direct ? dir : join(dir, target);
		if (!direct) mkdirSync(folder);
		writeFileSync(join(folder, `hopper-pi-${version}-rh8_20-${platform}.yak`), "test archive");
	}
	return {
		dir,
		add,
		run: (args: string[], fail = false) => spawnSync(process.execPath, ["scripts/yak.mjs", ...args, "--output", dir], {
			encoding: "utf8", env: { ...process.env, HOPPER_YAK: yak, YAK_TEST_LOG: log, YAK_TEST_FAIL_PUSH: fail ? "1" : "" },
		}),
		calls: () => { try { return readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)); } catch { return []; } },
	};
}

// The fake CLI is a POSIX executable; run these orchestration checks on macOS/Linux.
it.skipIf(process.platform === "win32")("checks both files before invoking login or upload", () => {
	const f = fixture(); f.add("mac-arm64", "mac");
	expect(f.run(["push", "public"]).status).toBe(1);
	expect(f.calls()).toEqual([]);
});

it.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("installs local builds from either custom output layout", () => {
	for (const direct of [false, true]) {
		const f = fixture(); f.add("mac-arm64", "mac", direct);
		const result = f.run(["install", "local"]);
		expect(result.status, result.stderr).toBe(0);
		expect(f.calls()).toEqual([["install", "--source", direct ? f.dir : join(f.dir, "mac-arm64"), "hopper-pi", version]]);
	}
});

it.skipIf(process.platform === "win32")("does not accept a single-target output as a combined upload", () => {
	const f = fixture(); f.add("mac-arm64", "mac", true);
	expect(f.run(["push", "public"]).status).toBe(1);
	expect(f.calls()).toEqual([]);
});

it.skipIf(process.platform === "win32")("dry-run never invokes Yak", () => {
	const f = fixture(); f.add("mac-arm64", "mac"); f.add("win-x64", "win");
	const result = f.run(["push", "public", "--dry-run"]);
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("https://yak.rhino3d.com");
	expect(f.calls()).toEqual([]);
});

it.skipIf(process.platform === "win32")("uploads both distributions only to the selected test server", () => {
	const f = fixture(); f.add("mac-arm64", "mac"); f.add("win-x64", "win");
	expect(f.run(["push", "test"]).status).toBe(0);
	const calls = f.calls();
	expect(calls.map((args) => args[0])).toEqual(["login", "push", "push", "search"]);
	for (const args of calls) expect(args.slice(1, 3)).toEqual(["--source", "https://test.yak.rhino3d.com"]);
});

it.skipIf(process.platform === "win32")("stops after a failed upload", () => {
	const f = fixture(); f.add("mac-arm64", "mac"); f.add("win-x64", "win");
	expect(f.run(["push", "test"], true).status).toBe(1);
	expect(f.calls().map((args) => args[0])).toEqual(["login", "push"]);
});
