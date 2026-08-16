import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HopperCoreError } from "../core/errors.js";
import { cliError, cliResponse, type CliResponse } from "./response.js";
import type { PluginCommand } from "./args.js";
import type { CliDependencies } from "./handlers.js";
import { createBackendClient } from "../protocol/backend-client.js";

export type PluginDoctorReport = {
	installed: boolean;
	installPath: string | null;
	packageVersion: string;
	installedVersion: string | null;
	dotnetAvailable: boolean;
	profileReadable: boolean;
	backendReachable: boolean;
	problems: Array<{ code: string; message: string; remedy: string }>;
};

type InstallManifest = {
	packageVersion: string;
	builtAt: string;
	files: Array<{ name: string; sha256: string }>;
};

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGIN_PROJECT = join(PACKAGE_ROOT, "grasshopper-plugin", "rhino-zmq-poc.csproj");

function pluginDirectoryName(env: NodeJS.ProcessEnv = process.env): string {
	return env.HOPPER_GH_PLUGIN_DIR || "hoppercode";
}

function packageVersion(): string {
	try {
		return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function hasDotnet(): boolean {
	return spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
}

function targetFramework(): string {
	return platform() === "win32" ? "net7.0-windows" : "net7.0";
}

function buildOutputDir(): string {
	return join(PACKAGE_ROOT, "grasshopper-plugin", "bin", "Release", targetFramework());
}

function librariesRoot(env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.HOPPER_GH_LIBRARIES) return env.HOPPER_GH_LIBRARIES;
	if (platform() === "win32") {
		const appData = env.APPDATA;
		return appData ? join(appData, "Grasshopper", "Libraries") : null;
	}
	if (platform() === "darwin") {
		const base = join(homedir(), "Library", "Application Support", "McNeel", "Rhinoceros");
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
			.filter((entry): entry is { full: string; mtime: number } => entry !== null)
			.sort((left, right) => right.mtime - left.mtime);
		for (const { full } of versionDirs) {
			const plugIns = join(full, "Plug-ins");
			if (!existsSync(plugIns)) continue;
			for (const entry of readdirSync(plugIns)) {
				if (!entry.toLowerCase().includes("grasshopper")) continue;
				const libraries = join(plugIns, entry, "Libraries");
				if (existsSync(libraries)) return libraries;
			}
		}
	}
	return null;
}

export function resolvePluginInstallDirectory(env: NodeJS.ProcessEnv = process.env): string {
	const pluginDirName = pluginDirectoryName(env);
	const override = env.HOPPER_GH_LIBRARIES;
	if (override) {
		const resolved = resolve(override);
		if (resolved.endsWith(pluginDirName) || resolved.endsWith(`${pluginDirName}/`)) {
			return resolved;
		}
		if (resolved.endsWith("Libraries") || resolved.endsWith("Libraries/")) {
			return join(resolved, pluginDirName);
		}
		throw new HopperCoreError({
			code: "invalid_input",
			message: "HOPPER_GH_LIBRARIES must be the Grasshopper Libraries folder or the dedicated hoppercode plugin directory.",
			retryable: false,
		});
	}
	const root = librariesRoot(env);
	if (!root) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: "Could not find Grasshopper Libraries. Set HOPPER_GH_LIBRARIES to the Libraries folder.",
			retryable: false,
		});
	}
	return join(root, pluginDirName);
}

export function assertSafePluginInstallTarget(installDir: string, force: boolean): void {
	assertNotSymlink(installDir);
	const parent = dirname(installDir);
	assertNotSymlink(parent);
	if (!existsSync(installDir)) return;
	const manifest = readManifest(installDir);
	const existing = listInstallFiles(installDir);
	if (manifest) {
		const owned = new Set(manifest.files.map((file) => file.name));
		const strangers = existing.filter((name) => !owned.has(name));
		if (strangers.length > 0) {
			throw new HopperCoreError({
				code: "invalid_input",
				message: `Refusing to upgrade ${installDir}; it contains files Hopper does not own: ${strangers.join(", ")}.`,
				retryable: false,
			});
		}
		return;
	}
	if (existing.length > 0 && !force) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: `Refusing to install into non-Hopper directory ${installDir}. Re-run with --force only after confirming it is safe.`,
			retryable: false,
		});
	}
}

function assertNotSymlink(path: string): void {
	if (!existsSync(path)) return;
	if (lstatSync(path).isSymbolicLink()) {
		throw new HopperCoreError({
			code: "invalid_input",
			message: `Refusing to install into symlinked path ${path}.`,
			retryable: false,
		});
	}
}

function fileDigest(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readManifest(installDir: string): InstallManifest | null {
	const path = join(installDir, ".hopper-install.json");
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as InstallManifest;
	} catch {
		return null;
	}
}

function listInstallFiles(installDir: string): string[] {
	if (!existsSync(installDir)) return [];
	return readdirSync(installDir).filter((name) => name !== ".hopper-install.json").sort();
}

function buildPlugin(): void {
	if (!hasDotnet()) {
		throw new HopperCoreError({
			code: "internal_error",
			message: ".NET SDK not found. Install .NET 7 SDK and retry hopper plugin install.",
			retryable: false,
		});
	}
	const result = spawnSync("dotnet", ["build", PLUGIN_PROJECT, "-c", "Release"], {
		encoding: "utf8",
		cwd: dirname(PLUGIN_PROJECT),
	});
	if (result.status !== 0) {
		throw new HopperCoreError({
			code: "internal_error",
			message: result.stderr?.trim() || "dotnet build failed.",
			retryable: false,
		});
	}
}

export async function handlePlugin(
	command: PluginCommand,
	deps: CliDependencies,
): Promise<CliResponse> {
	try {
		if (command.kind === "plugin.doctor") {
			const report = await doctor(deps);
			return cliResponse({
				ok: report.problems.length === 0,
				command: "plugin.doctor",
				outcome: report.problems.length === 0 ? "succeeded" : "failed",
				message: report.problems.length === 0
					? "Plugin install looks healthy."
					: `${report.problems.length} plugin problem(s) found.`,
				data: report,
				artifacts: [],
				warnings: report.problems.map((problem) => ({
					code: problem.code,
					message: problem.message,
				})),
				error: report.problems.length === 0 ? null : {
					code: "operation_failed",
					message: report.problems[0]!.message,
					retryable: false,
				},
			});
		}
		const report = install(command.force);
		return cliResponse({
			ok: true,
			command: "plugin.install",
			outcome: "succeeded",
			message: `Installed Grasshopper plugin to ${report.installPath}.`,
			data: report,
			artifacts: [],
			warnings: [],
			error: null,
		});
	} catch (error) {
		if (error instanceof HopperCoreError) {
			return cliError(command.kind, error.hopperError);
		}
		return cliError(command.kind, {
			code: "internal_error",
			message: error instanceof Error ? error.message : String(error),
			retryable: false,
		});
	}
}

function install(force: boolean): PluginDoctorReport {
	const installDir = resolvePluginInstallDirectory();
	assertSafePluginInstallTarget(installDir, force);

	buildPlugin();
	const outputDir = buildOutputDir();
	const artifacts = readdirSync(outputDir).filter((name) => name.endsWith(".gha") || name.endsWith(".dll"));
	if (!artifacts.some((name) => name.endsWith(".gha"))) {
		throw new HopperCoreError({
			code: "internal_error",
			message: `Build produced no .gha in ${outputDir}.`,
			retryable: false,
		});
	}

	const staging = `${installDir}.hopper-staging-${Date.now()}`;
	mkdirSync(staging, { recursive: true, mode: 0o755 });
	try {
		const files: InstallManifest["files"] = [];
		for (const name of artifacts) {
			const destination = join(staging, name);
			copyFileSync(join(outputDir, name), destination);
			files.push({ name, sha256: fileDigest(destination) });
		}
		const manifest: InstallManifest = {
			packageVersion: packageVersion(),
			builtAt: new Date().toISOString(),
			files: files.sort((left, right) => left.name.localeCompare(right.name)),
		};
		writeFileSync(join(staging, ".hopper-install.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
		renameSync(staging, installDir);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}

	return {
		installed: true,
		installPath: installDir,
		packageVersion: packageVersion(),
		installedVersion: packageVersion(),
		dotnetAvailable: true,
		profileReadable: false,
		backendReachable: false,
		problems: [],
	};
}

async function doctor(deps: CliDependencies): Promise<PluginDoctorReport> {
	const problems: PluginDoctorReport["problems"] = [];
	let installPath: string | null = null;
	try {
		installPath = resolvePluginInstallDirectory();
	} catch (error) {
		problems.push({
			code: "install_path",
			message: error instanceof Error ? error.message : String(error),
			remedy: "Set HOPPER_GH_LIBRARIES to your Grasshopper Libraries folder.",
		});
	}
	const manifest = installPath ? readManifest(installPath) : null;
	const installed = !!(installPath && existsSync(installPath) && manifest);
	if (installPath && existsSync(installPath) && lstatSync(installPath).isSymbolicLink()) {
		problems.push({
			code: "symlink_target",
			message: `Install path ${installPath} is a symlink.`,
			remedy: "Point Hopper at a real directory, not a symlink.",
		});
	}
	if (!installed) {
		problems.push({
			code: "not_installed",
			message: "Hopper plugin is not installed.",
			remedy: "Run hopper plugin install.",
		});
	}
	const dotnetAvailable = hasDotnet();
	if (!dotnetAvailable) {
		problems.push({
			code: "dotnet_missing",
			message: ".NET SDK is not available.",
			remedy: "Install .NET 7 SDK to rebuild the Grasshopper plugin.",
		});
	}
	let profileReadable = false;
	try {
		const connection = deps.connection();
		profileReadable = existsSync(connection.profilePath);
	} catch {
		profileReadable = false;
	}
	if (!profileReadable) {
		problems.push({
			code: "profile_missing",
			message: "No Hopper connection profile is present yet.",
			remedy: "Start Rhino, open Grasshopper, and place the Hopper Code Backend component.",
		});
	}
	let backendReachable = false;
	try {
		const connection = deps.connection();
		const client = (deps.createProtocolClient ?? ((config) => createBackendClient(config)))(connection);
		try {
			const info = await client.getInfo();
			backendReachable = info.outcome === "succeeded";
		} catch {
			backendReachable = false;
			problems.push({
				code: "backend_offline",
				message: "The Grasshopper backend is not reachable.",
				remedy: "Confirm Rhino is running and the Hopper backend component is on the canvas.",
			});
		} finally {
			await client.close().catch(() => {});
		}
	} catch {
		backendReachable = false;
		problems.push({
			code: "backend_offline",
			message: "The Grasshopper backend is not reachable.",
			remedy: "Confirm Rhino is running and the Hopper backend component is on the canvas.",
		});
	}
	return {
		installed,
		installPath,
		packageVersion: packageVersion(),
		installedVersion: manifest?.packageVersion ?? null,
		dotnetAvailable,
		profileReadable,
		backendReachable,
		problems,
	};
}
