#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
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
const bundledNodeVersion = "v22.22.3";
const installer = join(scriptDirectory, "install-grasshopper-plugin.mjs");
const args = process.argv.slice(2);

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

function platformTag() {
	if (platform() === "win32") return "win";
	if (platform() === "darwin") return "mac";
	fail("Rhino packages can only be staged on Windows or macOS");
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

async function downloadOfficialNode(runtimeDirectory, architecture) {
	const version = bundledNodeVersion;
	const platformName = platform() === "darwin" ? "darwin" : "win";
	const archiveName = platform() === "win32"
		? `node-${version}-win-${architecture}.zip`
		: `node-${version}-darwin-${architecture}.tar.gz`;
	const distributionRoot = archiveName.replace(/\.tar\.gz$|\.zip$/, "");
	const downloadDirectory = join(runtimeDirectory, ".node-download");
	const archivePath = join(downloadDirectory, archiveName);
	mkdirSync(downloadDirectory, { recursive: true });

	const baseUrl = `https://nodejs.org/dist/${version}`;
	console.log(`[hopper-pi] Downloading official Node ${version} for ${platformName}-${architecture}`);
	const [archiveResponse, checksumResponse] = await Promise.all([
		fetch(`${baseUrl}/${archiveName}`),
		fetch(`${baseUrl}/SHASUMS256.txt`),
	]);
	if (!archiveResponse.ok || !checksumResponse.ok) {
		fail(`Could not download the official Node ${version} distribution`);
	}
	const archive = Buffer.from(await archiveResponse.arrayBuffer());
	const checksumText = await checksumResponse.text();
	const checksumLine = checksumText.split("\n").find((line) => line.endsWith(`  ${archiveName}`));
	const expected = checksumLine?.split(/\s+/)[0];
	const actual = createHash("sha256").update(archive).digest("hex");
	if (!expected || actual !== expected) fail(`Node archive checksum mismatch for ${archiveName}`);
	writeFileSync(archivePath, archive);

	if (platform() === "win32") {
		run("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Expand-Archive -LiteralPath $env:HOPPER_NODE_ARCHIVE -DestinationPath $env:HOPPER_NODE_DESTINATION",
		], {
			env: {
				HOPPER_NODE_ARCHIVE: archivePath,
				HOPPER_NODE_DESTINATION: downloadDirectory,
			},
		});
	} else {
		run("tar", ["-xzf", archivePath, "-C", downloadDirectory]);
	}

	const extracted = join(downloadDirectory, distributionRoot);
	if (!existsSync(extracted)) fail(`Extracted Node directory is missing: ${extracted}`);
	const nodeDirectory = join(runtimeDirectory, "node", `${platformName}-${architecture}`);
	mkdirSync(nodeDirectory, { recursive: true });
	const nodeRelative = platform() === "win32"
		? join("node", `${platformName}-${architecture}`, "node.exe")
		: join("node", `${platformName}-${architecture}`, "bin", "node");
	const nodeExecutable = join(runtimeDirectory, nodeRelative);
	mkdirSync(dirname(nodeExecutable), { recursive: true });
	const extractedExecutable = platform() === "win32"
		? join(extracted, "node.exe")
		: join(extracted, "bin", "node");
	copyFileSync(extractedExecutable, nodeExecutable);
	if (platform() !== "win32") chmodSync(nodeExecutable, 0o755);
	rmSync(downloadDirectory, { recursive: true, force: true });
	return { nodeExecutable, nodeRelative };
}

const defaultOutput = join(packageRoot, "artifacts", `hopper-pi-${packageJson.version}-${platformTag()}`);
const output = resolve(option("--output") ?? defaultOutput);
validateOutput(output);
mkdirSync(output, { recursive: true });

run("pnpm", ["build"]);
run(process.execPath, [installer, "--force"], {
	env: {
		HOPPER_GH_LIBRARIES: output,
		HOPPER_GH_STRICT: "1",
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
mkdirSync(join(hostDirectory, "scripts"), { recursive: true });
cpSync(installer, join(hostDirectory, "scripts", "install-grasshopper-plugin.mjs"));
for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "LICENSE"]) {
	cpSync(join(packageRoot, name), join(hostDirectory, name));
}

run("pnpm", ["install", "--prod", "--frozen-lockfile"], {
	cwd: hostDirectory,
	env: { HOPPER_SKIP_GH_PLUGIN: "1", PNPM_CONFIG_NODE_LINKER: "hoisted" },
});

removeBinDirectories(join(hostDirectory, "node_modules"));
const dependencyLink = findSymbolicLink(join(hostDirectory, "node_modules"));
if (dependencyLink) fail(`Production dependencies contain a non-portable link: ${dependencyLink}`);
const targetArchitectures = ["x64", "arm64"];
const nodeExecutables = {};
let nativeNodeExecutable;
for (const architecture of targetArchitectures) {
	const { nodeExecutable, nodeRelative } = await downloadOfficialNode(runtimeDirectory, architecture);
	const runtimeKey = `${platform() === "darwin" ? "osx" : "win"}-${architecture}`;
	nodeExecutables[runtimeKey] = nodeRelative.replaceAll("\\", "/");
	if (architecture === arch()) nativeNodeExecutable = nodeExecutable;
}
if (!nativeNodeExecutable) fail(`Unsupported build architecture: ${arch()}`);
run(nativeNodeExecutable, ["--version"]);
run(nativeNodeExecutable, ["--input-type=module", "--eval", "await import('zeromq')"], { cwd: hostDirectory });

writeFileSync(join(runtimeDirectory, "hopper-runtime.json"), JSON.stringify({
	protocolVersion: 1,
	nodeExecutables,
	hostEntry: "host/dist/host/index.js",
	nodeVersion: bundledNodeVersion,
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
	run(yak, ["build", "--platform", platformTag()], { cwd: output });
}

console.log(`[hopper-pi] Staged Rhino package at ${output}`);
