#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { arch, platform } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const installer = join(scriptDirectory, "install-grasshopper-plugin.mjs");
const verifier = join(scriptDirectory, "verify-rhino-package.mjs");
const args = process.argv.slice(2);
const targets = Object.freeze({
	"mac-arm64": Object.freeze({
		os: "darwin",
		cpu: "arm64",
		yakPlatform: "mac",
		clipboardPackage: "clipboard-darwin-arm64",
	}),
	"win-x64": Object.freeze({
		os: "win32",
		cpu: "x64",
		yakPlatform: "win",
		clipboardPackage: "clipboard-win32-x64-msvc",
	}),
});

function option(name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
	console.error(`[hopper-pi] ${message}`);
	process.exit(1);
}

function run(command, commandArgs, options = {}) {
	const windowsPnpm = platform() === "win32" && command === "pnpm";
	const executable = windowsPnpm ? (process.env.ComSpec || "cmd.exe") : command;
	const argsToRun = windowsPnpm ? ["/d", "/s", "/c", "pnpm", ...commandArgs] : commandArgs;
	const result = spawnSync(executable, argsToRun, {
		cwd: options.cwd ?? packageRoot,
		env: { ...process.env, ...options.env },
		stdio: "inherit",
		encoding: "utf8",
	});
	if (result.status !== 0) {
		const detail = result.error instanceof Error ? `: ${result.error.message}` : "";
		fail(`${basename(command)} failed with exit code ${result.status ?? "unknown"}${detail}`);
	}
}

function defaultTarget() {
	if (platform() === "darwin" && arch() === "arm64") return "mac-arm64";
	if (platform() === "win32" && arch() === "x64") return "win-x64";
	fail("--target is required when the build machine is not macOS arm64 or Windows x64");
}

function validateOutput(path) {
	if (!isAbsolute(path)) fail("--output must resolve to an absolute path");
	if (path === packageRoot || relative(path, packageRoot) === "") fail("Refusing to use the repository root as output");
	if (existsSync(path) && readdirSync(path).length > 0) fail(`Output directory is not empty: ${path}`);
}

function findYak() {
	const explicit = process.env.HOPPER_YAK;
	if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
	const known = platform() === "darwin"
		? "/Applications/Rhino 8.app/Contents/Resources/bin/yak"
		: "C:\\Program Files\\Rhino 8\\System\\Yak.exe";
	return existsSync(known) ? known : null;
}

function findSymbolicLink(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (lstatSync(path).isSymbolicLink()) return path;
		if (entry.isDirectory()) {
			const nested = findSymbolicLink(path);
			if (nested) return nested;
		}
	}
	return null;
}

function removeBinDirectories(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && entry.name === ".bin") {
			rmSync(path, { recursive: true, force: true });
		} else if (entry.isDirectory()) {
			removeBinDirectories(path);
		}
	}
}

function removeDependencyDevelopmentFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && (entry.name === ".pnpm" || /^(?:__tests__|tests?)$/i.test(entry.name))) {
			rmSync(path, { recursive: true, force: true });
		} else if (entry.isDirectory()) {
			removeDependencyDevelopmentFiles(path);
		} else if (/^(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/i.test(entry.name)
			|| entry.name === ".modules.yaml"
			|| entry.name === ".pnpm-workspace-state-v1.json"
			|| /\.(test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)
			|| entry.name.endsWith(".map")) {
			rmSync(path, { force: true });
		}
	}
}

function pruneNativeDependencies(nodeModules, targetConfig) {
	// Pi's Chord runtime uses esbuild's JS API, which resolves the @esbuild binary.
	// Its install script also copies that binary into bin/ for CLI use.
	rmSync(join(nodeModules, "esbuild", "bin"), { recursive: true, force: true });
	const zeromqBuild = join(nodeModules, "zeromq", "build");
	if (existsSync(zeromqBuild)) {
		for (const entry of readdirSync(zeromqBuild, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const operatingSystemPath = join(zeromqBuild, entry.name);
			if (entry.name !== targetConfig.os) {
				rmSync(operatingSystemPath, { recursive: true, force: true });
				continue;
			}
			for (const cpuEntry of readdirSync(operatingSystemPath, { withFileTypes: true })) {
				if (cpuEntry.isDirectory() && cpuEntry.name !== targetConfig.cpu) {
					rmSync(join(operatingSystemPath, cpuEntry.name), { recursive: true, force: true });
				}
			}
		}
	}

	const tuiNative = join(nodeModules, "@earendil-works", "pi-tui", "native");
	if (existsSync(tuiNative)) {
		for (const entry of readdirSync(tuiNative, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const operatingSystemPath = join(tuiNative, entry.name);
			if (entry.name !== targetConfig.os) {
				rmSync(operatingSystemPath, { recursive: true, force: true });
				continue;
			}
			const prebuilds = join(operatingSystemPath, "prebuilds");
			if (!existsSync(prebuilds)) continue;
			for (const prebuild of readdirSync(prebuilds)) {
				if (prebuild !== `${targetConfig.os}-${targetConfig.cpu}`) {
					rmSync(join(prebuilds, prebuild), { recursive: true, force: true });
				}
			}
		}
	}

	const clipboardScope = join(nodeModules, "@mariozechner");
	if (existsSync(clipboardScope)) {
		for (const packageName of readdirSync(clipboardScope)) {
			if (packageName.startsWith("clipboard-") && packageName !== targetConfig.clipboardPackage) {
				rmSync(join(clipboardScope, packageName), { recursive: true, force: true });
			}
		}
	}

	rmSync(join(nodeModules, "@types"), { recursive: true, force: true });
}

const target = option("--target") ?? defaultTarget();
const targetConfig = targets[target];
if (!targetConfig) fail(`--target must be one of: ${Object.keys(targets).join(", ")}`);
const defaultOutput = join(packageRoot, "artifacts", `hopper-pi-${packageJson.version}-${target}`);
const output = resolve(option("--output") ?? defaultOutput);
validateOutput(output);
mkdirSync(output, { recursive: true });

run("pnpm", ["build:release"]);
run(process.execPath, [installer, "--force", "--target", target], {
	env: {
		HOPPER_GH_LIBRARIES: output,
		HOPPER_GH_STRICT: "1",
		HOPPER_PACKAGE_STAGE: "1",
		HOPPER_SKIP_GH_PLUGIN: "0",
	},
});
// The installer stamp contains local absolute build paths. It is useful for a
// developer install, but it is neither needed nor portable inside a Yak package.
rmSync(join(output, ".hopper-install.json"), { force: true });

const runtimeDirectory = join(output, "runtime");
const hostDirectory = join(runtimeDirectory, "host");
mkdirSync(hostDirectory, { recursive: true });
cpSync(join(packageRoot, "dist"), join(hostDirectory, "dist"), { recursive: true });
cpSync(join(packageRoot, "mds"), join(hostDirectory, "mds"), { recursive: true });
for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "LICENSE"]) {
	cpSync(join(packageRoot, name), join(hostDirectory, name));
}
writeFileSync(join(hostDirectory, "package.json"), JSON.stringify({
	name: packageJson.name,
	version: packageJson.version,
	private: true,
	type: packageJson.type,
	engines: { node: ">=22.19.0" },
	dependencies: packageJson.dependencies,
	devDependencies: packageJson.devDependencies,
}, null, 2) + "\n");

run("pnpm", ["install", "--prod", "--frozen-lockfile"], {
	cwd: hostDirectory,
	env: {
		HOPPER_SKIP_GH_PLUGIN: "1",
		PNPM_CONFIG_NODE_LINKER: "hoisted",
		npm_config_platform: targetConfig.os,
		npm_config_arch: targetConfig.cpu,
		npm_config_target_platform: targetConfig.os,
		npm_config_target_arch: targetConfig.cpu,
	},
});

const nodeModules = join(hostDirectory, "node_modules");
removeBinDirectories(nodeModules);
removeDependencyDevelopmentFiles(nodeModules);
pruneNativeDependencies(nodeModules, targetConfig);
const dependencyLink = findSymbolicLink(nodeModules);
if (dependencyLink) fail(`Production dependencies contain a non-portable link: ${dependencyLink}`);
rmSync(join(hostDirectory, "pnpm-lock.yaml"), { force: true });
rmSync(join(hostDirectory, "pnpm-workspace.yaml"), { force: true });

writeFileSync(join(runtimeDirectory, "hopper-runtime.json"), JSON.stringify({
	protocolVersion: 2,
	minimumNodeVersion: "22.19.0",
	hostEntry: "host/dist/host/index.js",
}, null, 2) + "\n");

writeFileSync(join(output, "manifest.yml"), [
	"name: hopper-pi",
	`version: ${packageJson.version}`,
	"authors:",
	"  - hoppercode contributors",
	"description: Private, browser-based Hopper agent for Rhino 8 and Grasshopper.",
	"url: https://github.com/tsoumdoa/hoppercode",
	"keywords:",
	"  - grasshopper",
	"  - rhino",
	"  - agent",
	"",
].join("\n"));

if (args.includes("--yak")) {
	const yak = findYak();
	if (!yak) fail("Yak was not found. Set HOPPER_YAK to its absolute executable path.");
	run(yak, ["build", "--platform", targetConfig.yakPlatform], { cwd: output });
}

run(process.execPath, [verifier, "--target", target, output]);
console.log(`[hopper-pi] Staged ${target} Rhino package at ${output}`);
