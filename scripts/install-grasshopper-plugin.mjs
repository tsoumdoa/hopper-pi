#!/usr/bin/env node
/**
 * Build the Grasshopper plugin without installing it.
 *
 * Plugin installation belongs to `hopper plugin install`, which validates the
 * target directory and replaces only files recorded in Hopper's manifest.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const pluginProjectDirectory = join(packageRoot, "grasshopper-plugin");
const projectFile = join(pluginProjectDirectory, "rhino-zmq-poc.csproj");
const args = new Set(process.argv.slice(2));

function log(...parts) {
	console.log("[hoppercode]", ...parts);
}

function fail(message, code = 1) {
	if (process.env.HOPPER_GH_STRICT === "1") {
		console.error("[hoppercode]", message);
		process.exit(code);
	}
	console.warn("[hoppercode]", message);
	process.exit(0);
}

function targetFramework() {
	return platform() === "win32" ? "net7.0-windows" : "net7.0";
}

function buildOutputDirectory() {
	return join(pluginProjectDirectory, "bin", "Release", targetFramework());
}

function main() {
	if (process.env.HOPPER_SKIP_GH_PLUGIN === "1") {
		log("HOPPER_SKIP_GH_PLUGIN=1, skipping Grasshopper plugin build");
		return;
	}
	if (!args.has("--build-only")) {
		console.error(
			"[hoppercode] This legacy script no longer installs files. Run `hopper plugin install` instead.",
		);
		process.exit(1);
	}
	if (!existsSync(projectFile)) fail(`Grasshopper plugin project not found: ${projectFile}`);

	const dotnet = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
	if (dotnet.status !== 0) {
		fail(".NET SDK not found. Install .NET 7 SDK, then retry the build.");
	}

	log(`Building ${projectFile} (Release)`);
	let result = spawnSync(
		"dotnet",
		["build", projectFile, "-c", "Release", "--no-restore"],
		{ cwd: pluginProjectDirectory, encoding: "utf8", stdio: "inherit" },
	);
	if (result.status !== 0) {
		result = spawnSync(
			"dotnet",
			["build", projectFile, "-c", "Release"],
			{ cwd: pluginProjectDirectory, encoding: "utf8", stdio: "inherit" },
		);
	}
	if (result.status !== 0) fail("dotnet build failed");

	const outputDirectory = buildOutputDirectory();
	const artifacts = existsSync(outputDirectory) ? readdirSync(outputDirectory) : [];
	const ghaCount = artifacts.filter((name) => name.endsWith(".gha")).length;
	const dllCount = artifacts.filter((name) => name.endsWith(".dll")).length;
	if (ghaCount === 0) fail(`Build produced no .gha in ${outputDirectory}`);
	log(`Build OK: ${outputDirectory} (${ghaCount} gha, ${dllCount} dll)`);
}

main();
