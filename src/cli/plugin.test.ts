import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { HopperCoreError } from "../core/errors.js";
import {
	assertSafePluginInstallTarget,
	resolvePluginInstallDirectory,
} from "./plugin.js";

test("plugin install refuses an ambiguous HOPPER_GH_LIBRARIES override", () => {
	assert.throws(
		() => resolvePluginInstallDirectory({ HOPPER_GH_LIBRARIES: "/tmp/random-folder" }),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "invalid_input",
	);
});

test("plugin install resolves the dedicated hoppercode directory under Libraries", () => {
	const dir = resolvePluginInstallDirectory({
		HOPPER_GH_LIBRARIES: "/tmp/Grasshopper/Libraries",
	});
	assert.equal(dir, "/tmp/Grasshopper/Libraries/hoppercode");
});

test("plugin install refuses a populated non-Hopper directory without deleting it", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-plugin-"));
	const installDir = join(root, "hoppercode");
	await mkdir(installDir);
	const stranger = join(installDir, "user-file.txt");
	await writeFile(stranger, "keep me\n");
	assert.throws(
		() => assertSafePluginInstallTarget(installDir, false),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "invalid_input",
	);
	assert.throws(
		() => assertSafePluginInstallTarget(installDir, true),
		(error: unknown) => error instanceof HopperCoreError && error.hopperError.code === "invalid_input",
	);
	assert.equal(await readFile(stranger, "utf8"), "keep me\n");
});

test("plugin install refuses a symlink target without following it", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-plugin-"));
	const real = join(root, "real");
	const link = join(root, "hoppercode");
	await mkdir(real);
	await writeFile(join(real, "owned.dll"), "dll");
	await symlink(real, link);
	assert.throws(
		() => assertSafePluginInstallTarget(link, true),
		(error: unknown) => error instanceof HopperCoreError && /symlink/i.test(error.message),
	);
	assert.equal(await readFile(join(real, "owned.dll"), "utf8"), "dll");
});

test("postinstall delegates to the guarded installer without touching an ambiguous override", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-postinstall-plugin-"));
	const marker = join(root, "keep.txt");
	await writeFile(marker, "keep me\n");
	const result = spawnSync(process.execPath, ["scripts/install-grasshopper-plugin.mjs"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			HOPPER_GH_LIBRARIES: root,
			HOPPER_GH_STRICT: "1",
		},
		encoding: "utf8",
	});

	assert.notEqual(result.status, 0);
	assert.match(`${result.stdout}\n${result.stderr}`, /HOPPER_GH_LIBRARIES must be the Grasshopper Libraries folder/);
	assert.equal(await readFile(marker, "utf8"), "keep me\n");
});

test("postinstall warns instead of breaking package installation by default", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-postinstall-plugin-"));
	const result = spawnSync(process.execPath, ["scripts/install-grasshopper-plugin.mjs"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			HOPPER_GH_LIBRARIES: root,
			HOPPER_GH_STRICT: "0",
		},
		encoding: "utf8",
	});

	assert.equal(result.status, 0);
	assert.match(result.stderr, /Automatic Grasshopper plugin install failed/);
});
