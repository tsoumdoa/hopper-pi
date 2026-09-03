#!/usr/bin/env node
/**
 * Build Hopper's Grasshopper and Rhino plug-ins, then install them
 * into Grasshopper Libraries/hopper-pi/. A small runtime manifest points the
 * Rhino plug-in at this package's compiled, dependency-local host.
 *
 * Env:
 *   HOPPER_SKIP_GH_PLUGIN=1  — skip entirely (dev / git clone)
 *   HOPPER_GH_LIBRARIES      — full path to plugin install dir (overrides auto-detect)
 *   HOPPER_GH_PLUGIN_DIR     — subfolder name under Libraries (default: hopper-pi)
 *   HOPPER_GH_STRICT=1       — exit 1 on copy/build failure (default: warn and exit 0)
 */

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const GHA_PROJECT_DIR = join(PACKAGE_ROOT, "dotnet", "Hopper.Grasshopper");
const GHA_PROJECT_FILE = join(GHA_PROJECT_DIR, "Hopper.Grasshopper.csproj");
const RHP_PROJECT_DIR = join(PACKAGE_ROOT, "dotnet", "Hopper.Rhino");
const RHP_PROJECT_FILE = join(RHP_PROJECT_DIR, "Hopper.Rhino.csproj");
const HOST_ENTRY = join(PACKAGE_ROOT, "dist", "host", "index.js");
const RUNTIME_MANIFEST = "hopper-runtime.json";

const args = new Set(process.argv.slice(2));
const buildOnly = args.has("--build-only");
const force = args.has("--force");

function log(...parts) {
	console.log("[hopper-pi]", ...parts);
}

function warn(...parts) {
	console.warn("[hopper-pi]", ...parts);
}

function fail(message, code = 1) {
	if (process.env.HOPPER_GH_STRICT === "1") {
		console.error("[hopper-pi]", message);
		process.exit(code);
	}
	warn(message);
	process.exit(0);
}

function hasDotnet() {
	const r = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
	return r.status === 0;
}

function targetFramework() {
	return platform() === "win32" ? "net7.0-windows" : "net7.0";
}

function ghaOutputDir(configuration = "Release") {
	return join(
		GHA_PROJECT_DIR,
		"bin",
		configuration,
		targetFramework()
	);
}

function rhpOutputDir(configuration = "Release") {
	return join(
		RHP_PROJECT_DIR,
		"bin",
		configuration,
		targetFramework()
	);
}

function findGrasshopperLibrariesRoot() {
	if (process.env.HOPPER_GH_LIBRARIES) {
		return process.env.HOPPER_GH_LIBRARIES;
	}

	if (platform() === "win32") {
		const appData = process.env.APPDATA;
		if (!appData) return null;
		return join(appData, "Grasshopper", "Libraries");
	}

	if (platform() === "darwin") {
		const base = join(
			homedir(),
			"Library",
			"Application Support",
			"McNeel",
			"Rhinoceros"
		);
		if (!existsSync(base)) return null;

		const versionDirs = readdirSync(base)
			.map((name) => {
				const full = join(base, name);
				try {
					return { full, mtime: statSync(full).mtimeMs };
				} catch {
					return null;
				}
			})
			.filter(Boolean)
			.sort((a, b) => b.mtime - a.mtime);

		for (const { full: versionPath } of versionDirs) {
			const plugIns = join(versionPath, "Plug-ins");
			if (!existsSync(plugIns)) continue;
			for (const entry of readdirSync(plugIns)) {
				if (!entry.toLowerCase().includes("grasshopper")) continue;
				const libraries = join(plugIns, entry, "Libraries");
				if (existsSync(libraries)) return libraries;
			}
		}
		return null;
	}

	warn(`Unsupported platform for auto Libraries path: ${platform()}`);
	return null;
}

function resolveInstallDir() {
	const subdir = process.env.HOPPER_GH_PLUGIN_DIR || "hopper-pi";

	if (process.env.HOPPER_GH_LIBRARIES) {
		const p = process.env.HOPPER_GH_LIBRARIES;
		if (p.endsWith(subdir) || p.endsWith(`${subdir}/`)) return resolve(p);
		const base = p.replace(/\/$/, "");
		if (base.endsWith("Libraries")) return join(base, subdir);
		return resolve(p);
	}

	const librariesRoot = findGrasshopperLibrariesRoot();
	if (!librariesRoot) return null;
	return join(librariesRoot, subdir);
}

function readPackageVersion() {
	try {
		const pkg = JSON.parse(
			readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
		);
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function listArtifacts(outputDir, extensions) {
	if (!existsSync(outputDir)) return [];
	const entries = readdirSync(outputDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
		.map((entry) => entry.name)
		.sort();
}

function dotnetBuild(configuration) {
	for (const projectFile of [GHA_PROJECT_FILE, RHP_PROJECT_FILE]) {
		log(`Building ${projectFile} (${configuration}, ${targetFramework()})…`);
		const buildArgs = ["build", projectFile, "-c", configuration, "-f", targetFramework()];
		const first = spawnSync(
			"dotnet",
			[...buildArgs, "--no-restore"],
			{ cwd: PACKAGE_ROOT, encoding: "utf8", stdio: "inherit" }
		);
		if (first.status === 0) continue;
		const restored = spawnSync(
			"dotnet",
			buildArgs,
			{ cwd: PACKAGE_ROOT, encoding: "utf8", stdio: "inherit" }
		);
		if (restored.status !== 0) fail(`dotnet build failed: ${projectFile}`);
	}
}

function artifactSources(configuration) {
	const ghaDir = ghaOutputDir(configuration);
	const rhpDir = rhpOutputDir(configuration);
	const pluginExtensions = [".dll", ".gha", ".rhp", ".deps.json", ".runtimeconfig.json"];
	const approvedArtifacts = new Set([
		"Hopper.Grasshopper.gha",
		"Hopper.Grasshopper.deps.json",
		"Hopper.Grasshopper.runtimeconfig.json",
		"Hopper.Rhino.rhp",
		"Hopper.Rhino.deps.json",
		"Hopper.Rhino.runtimeconfig.json",
		"Hopper.Core.dll",
		"AsyncIO.dll",
		"Microsoft.Bcl.AsyncInterfaces.dll",
		"Microsoft.Extensions.ObjectPool.dll",
		"Microsoft.Win32.SystemEvents.dll",
		"NaCl.dll",
		"NetMQ.dll",
		"System.Drawing.Common.dll",
		"System.Private.ServiceModel.dll",
		"System.Security.Cryptography.Pkcs.dll",
		"System.Security.Cryptography.Xml.dll",
		"System.Security.Permissions.dll",
		"System.ServiceModel.Primitives.dll",
		"System.ServiceModel.dll",
		"System.Windows.Extensions.dll",
	]);
	const sources = new Map();
	for (const outputDir of [ghaDir, rhpDir]) {
		for (const name of listArtifacts(outputDir, pluginExtensions)) {
			if (!approvedArtifacts.has(name)) continue;
			const existing = sources.get(name);
			if (!existing || name.endsWith(".rhp")) sources.set(name, join(outputDir, name));
		}
	}
	return { ghaDir, rhpDir, sources };
}

function removePreviousInstallFiles(installDir) {
	const stampPath = join(installDir, ".hopper-install.json");
	if (existsSync(stampPath)) {
		try {
			const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
			for (const name of stamp.files ?? []) {
				if (typeof name !== "string" || name.includes("..")) continue;
				rmSync(join(installDir, name), { recursive: true, force: true });
			}
		} catch {
			warn("Could not read the previous install stamp; existing Hopper files will be overwritten.");
		}
	}

	for (const staleName of [
		"rhino-zmq-poc.gha",
		"rhino-zmq-poc.deps.json",
		"rhino-zmq-poc.runtimeconfig.json",
		"Hopper.Backend.dll",
		"Hopper.Rhino.Host.dll",
	]) {
		rmSync(join(installDir, staleName), { force: true });
	}
}

function writeRuntimeManifest(installDir) {
	if (!existsSync(HOST_ENTRY)) {
		warn("Compiled browser host is missing. Run `pnpm build`, then reinstall the plug-in.");
		return null;
	}
	const runtimeDir = join(installDir, "runtime");
	mkdirSync(runtimeDir, { recursive: true });
	const manifestPath = join(runtimeDir, RUNTIME_MANIFEST);
	writeFileSync(manifestPath, JSON.stringify({
		protocolVersion: 1,
		nodeExecutable: process.execPath,
		hostEntry: HOST_ENTRY,
		packageRoot: PACKAGE_ROOT,
	}, null, 2) + "\n");
	return join("runtime", RUNTIME_MANIFEST);
}

function copyArtifacts(configuration, installDir) {
	const { ghaDir, rhpDir, sources } = artifactSources(configuration);
	if (![...sources.keys()].some((name) => name.endsWith(".gha"))) fail(`No .gha found in ${ghaDir}`);
	if (![...sources.keys()].some((name) => name.endsWith(".rhp"))) fail(`No .rhp found in ${rhpDir}`);

	mkdirSync(installDir, { recursive: true });
	removePreviousInstallFiles(installDir);

	const copied = [];
	for (const [name, source] of sources) {
		copyFileSync(source, join(installDir, name));
		copied.push(name);
	}
	const runtimeManifest = writeRuntimeManifest(installDir);
	if (runtimeManifest) copied.push(runtimeManifest);

	writeFileSync(
		join(installDir, ".hopper-install.json"),
		JSON.stringify(
			{
				packageVersion: readPackageVersion(),
				builtAt: new Date().toISOString(),
				configuration: "Release",
				targetFramework: targetFramework(),
				outputDirs: [ghaDir, rhpDir],
				installDir,
				files: copied.sort(),
			},
			null,
			2
		)
	);

	return { copied };
}

function shouldSkipBuild(installDir, version) {
	if (force || !installDir || !existsSync(installDir)) return false;
	const stampPath = join(installDir, ".hopper-install.json");
	if (!existsSync(stampPath)) return false;
	try {
		const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
		return stamp.packageVersion === version && stamp.files?.length > 0;
	} catch {
		return false;
	}
}

function main() {
	if (process.env.HOPPER_SKIP_GH_PLUGIN === "1") {
		log("HOPPER_SKIP_GH_PLUGIN=1 — skipping Grasshopper plugin install");
		return;
	}

	if (!existsSync(GHA_PROJECT_FILE) || !existsSync(RHP_PROJECT_FILE)) {
		fail("Hopper GHA or RHP project file was not found");
	}

	if (!hasDotnet()) {
		warn(
			".NET SDK not found. Install .NET 7 SDK, then run: pnpm run build:gh-plugin"
		);
		return;
	}

	const configuration = "Release";
	const version = readPackageVersion();
	const installDir = buildOnly ? null : resolveInstallDir();

	if (!buildOnly && !installDir) {
		fail(
			"Could not find Grasshopper Libraries folder. Set HOPPER_GH_LIBRARIES to your plugin directory path."
		);
	}

	if (!shouldSkipBuild(installDir, version)) {
		dotnetBuild(configuration);
	} else {
		log(`Skipping build (already installed v${version}, use --force to rebuild)`);
	}

	const artifacts = artifactSources(configuration);
	const names = [...artifacts.sources.keys()];
	if (!names.some((name) => name.endsWith(".gha")) || !names.some((name) => name.endsWith(".rhp")))
		fail("Build did not produce both Hopper's .gha and .rhp artifacts");

	if (buildOnly) {
		log(`Build OK: ${names.filter((name) => name.endsWith(".gha")).length} gha, ${names.filter((name) => name.endsWith(".rhp")).length} rhp, ${names.filter((name) => name.endsWith(".dll")).length} dll`);
		return;
	}

	try {
		const { copied } = copyArtifacts(configuration, installDir);
		log(`Installed Hopper to ${installDir} (${copied.length} managed files)`);
		log("Restart Rhino to load the GHZMQ compatibility component. Install the generated Yak package to use _HopperCode.");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		fail(`Failed to copy plugin: ${msg}`);
	}
}

main();
