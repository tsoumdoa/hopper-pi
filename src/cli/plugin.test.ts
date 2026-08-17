import assert from "node:assert/strict";
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
