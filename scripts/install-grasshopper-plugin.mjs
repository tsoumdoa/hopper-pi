#!/usr/bin/env node
/**
 * Build the Grasshopper plugin, or install it through Hopper's guarded plugin
 * manager when npm runs this script as a postinstall hook.
 *
 * HOPPER_SKIP_GH_PLUGIN=1 skips both modes. HOPPER_GH_STRICT=1 makes an
 * automatic install failure fail the package install instead of warning.
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
const builtCli = join(packageRoot, "dist", "cli", "main.js");
const sourceCli = join(packageRoot, "src", "cli", "main.ts");
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

function buildPlugin() {
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

function installPlugin() {
	let cliArgs;
	if (existsSync(sourceCli)) {
		cliArgs = ["--import", "tsx", sourceCli, "plugin", "install"];
	} else if (existsSync(builtCli)) {
		cliArgs = [builtCli, "plugin", "install"];
	} else {
		fail("Could not find the built or source Hopper CLI needed to install the plugin.");
	}
	if (args.has("--force")) cliArgs.push("--force");

	const result = spawnSync(process.execPath, cliArgs, {
		cwd: packageRoot,
		encoding: "utf8",
		stdio: "inherit",
	});
	if (result.error) fail(`Automatic Grasshopper plugin install failed: ${result.error.message}`);
	if (result.status !== 0) {
		fail("Automatic Grasshopper plugin install failed. Run `hopper plugin install` for details.", result.status ?? 1);
	}
}

function main() {
	if (process.env.HOPPER_SKIP_GH_PLUGIN === "1") {
		log("HOPPER_SKIP_GH_PLUGIN=1, skipping Grasshopper plugin build/install");
		return;
	}
	if (args.has("--build-only")) {
		buildPlugin();
		return;
	}
	installPlugin();
}

main();
