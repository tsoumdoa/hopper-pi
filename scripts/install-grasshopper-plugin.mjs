#!/usr/bin/env node
/**
 * Build rhino-zmq-poc and install into Grasshopper Libraries/hoppercode/
 *
 * Env:
 *   HOPPER_SKIP_GH_PLUGIN=1  — skip entirely (dev / git clone)
 *   HOPPER_GH_LIBRARIES      — full path to plugin install dir (overrides auto-detect)
 *   HOPPER_GH_PLUGIN_DIR     — subfolder name under Libraries (default: hoppercode)
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
const PLUGIN_PROJECT_DIR = join(PACKAGE_ROOT, "grasshopper-plugin");
const PROJECT_FILE = join(PLUGIN_PROJECT_DIR, "rhino-zmq-poc.csproj");

const args = new Set(process.argv.slice(2));
const buildOnly = args.has("--build-only");
const force = args.has("--force");

function log(...parts) {
	console.log("[hoppercode]", ...parts);
}

function warn(...parts) {
	console.warn("[hoppercode]", ...parts);
}

function fail(message, code = 1) {
	if (process.env.HOPPER_GH_STRICT === "1") {
		console.error("[hoppercode]", message);
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

function buildOutputDir(configuration = "Release") {
	return join(
		PLUGIN_PROJECT_DIR,
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
	const subdir = process.env.HOPPER_GH_PLUGIN_DIR || "hoppercode";

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

function listArtifacts(outputDir) {
	if (!existsSync(outputDir)) return { gha: [], dll: [] };
	const entries = readdirSync(outputDir, { withFileTypes: true });
	const gha = [];
	const dll = [];
	for (const e of entries) {
		if (!e.isFile()) continue;
		if (e.name.endsWith(".gha")) gha.push(e.name);
		if (e.name.endsWith(".dll")) dll.push(e.name);
	}
	return { gha, dll };
}

function dotnetBuild(configuration) {
	log(`Building ${PROJECT_FILE} (${configuration})…`);
	const r = spawnSync(
		"dotnet",
		["build", PROJECT_FILE, "-c", configuration, "--no-restore"],
		{ cwd: PLUGIN_PROJECT_DIR, encoding: "utf8", stdio: "inherit" }
	);
	if (r.status !== 0) {
		const r2 = spawnSync(
			"dotnet",
			["build", PROJECT_FILE, "-c", configuration],
			{ cwd: PLUGIN_PROJECT_DIR, encoding: "utf8", stdio: "inherit" }
		);
		if (r2.status !== 0) fail("dotnet build failed");
	}
}

function copyArtifacts(outputDir, installDir) {
	const { gha, dll } = listArtifacts(outputDir);
	if (gha.length === 0) {
		fail(`No .gha found in ${outputDir}`);
	}

	mkdirSync(installDir, { recursive: true });

	for (const name of readdirSync(installDir)) {
		if (name === ".hopper-install.json") continue;
		rmSync(join(installDir, name), { recursive: true, force: true });
	}

	const copied = [];
	for (const name of [...gha, ...dll]) {
		copyFileSync(join(outputDir, name), join(installDir, name));
		copied.push(name);
	}

	writeFileSync(
		join(installDir, ".hopper-install.json"),
		JSON.stringify(
			{
				packageVersion: readPackageVersion(),
				builtAt: new Date().toISOString(),
				configuration: "Release",
				targetFramework: targetFramework(),
				outputDir,
				installDir,
				files: copied.sort(),
			},
			null,
			2
		)
	);

	return { gha, dll, copied };
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

	if (!existsSync(PROJECT_FILE)) {
		fail(`Grasshopper plugin project not found: ${PROJECT_FILE}`);
	}

	if (!hasDotnet()) {
		warn(
			".NET SDK not found. Install .NET 7 SDK, then run: pnpm run build:gh-plugin"
		);
		return;
	}

	const configuration = "Release";
	const outputDir = buildOutputDir(configuration);
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

	const { gha, dll } = listArtifacts(outputDir);
	if (gha.length === 0) {
		fail(`Build produced no .gha in ${outputDir}`);
	}

	if (buildOnly) {
		log(`Build OK: ${outputDir} (${gha.length} gha, ${dll.length} dll)`);
		return;
	}

	try {
		const { copied } = copyArtifacts(outputDir, installDir);
		log(
			`Installed Grasshopper plugin to ${installDir} (${copied.length} files: ${gha.length} .gha, ${dll.length} .dll)`
		);
		log(
			"Restart Rhino/Grasshopper, then place the GH ZMQ Plugin component on the canvas."
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		fail(`Failed to copy plugin: ${msg}`);
	}
}

main();
