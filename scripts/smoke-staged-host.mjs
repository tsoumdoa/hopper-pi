#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const stage = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: smoke-staged-host.mjs <staging-directory>");
const runtimeDirectory = join(stage, "runtime");
const manifest = JSON.parse(await readFile(join(runtimeDirectory, "hopper-runtime.json"), "utf8"));
if (manifest.protocolVersion !== 2 || typeof manifest.hostEntry !== "string") {
	throw new Error("The staged runtime manifest must contain protocolVersion 2 and a hostEntry string.");
}

const hostEntry = resolve(runtimeDirectory, manifest.hostEntry);
const relativeHostEntry = relative(runtimeDirectory, hostEntry);
if (relativeHostEntry === "" || relativeHostEntry.startsWith("..") || isAbsolute(relativeHostEntry)) {
	throw new Error("The staged host entry must remain inside the runtime directory.");
}
const hostDirectory = join(runtimeDirectory, "host");
const nodeExecutable = process.env.HOPPER_NODE_EXECUTABLE || process.execPath;
const smokeSource = [
	`await import(${JSON.stringify(pathToFileURL(hostEntry).href)});`,
	`await import("zeromq");`,
	`const esbuild = await import("esbuild");`,
	`await esbuild.transform("const value: number = 1", { loader: "ts" });`,
	`process.stdout.write(process.version);`,
].join("\n");
const child = spawn(nodeExecutable, ["--input-type=module", "--eval", smokeSource], {
	cwd: hostDirectory,
	stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

const exitCode = await new Promise((accept, reject) => {
	const timeout = setTimeout(() => {
		child.kill("SIGKILL");
		reject(new Error("Staged runtime import timed out after 30 seconds."));
	}, 30_000);
	child.once("error", (error) => {
		clearTimeout(timeout);
		reject(error);
	});
	child.once("exit", (code) => {
		clearTimeout(timeout);
		accept(code);
	});
});

if (exitCode !== 0) {
	throw new Error(`Staged runtime import failed with exit code ${exitCode ?? "unknown"}. ${stderr.trim()}`);
}
const nodeVersion = stdout.trim();
const versionMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
const version = versionMatch?.slice(1).map(Number);
if (!version || version[0] < 22 || (version[0] === 22 && version[1] < 19)) {
	throw new Error(`Staged runtime smoke requires stable Node 22.19.0 or newer; found ${nodeVersion || "no version"}.`);
}

// Starting the HTTP host without Rhino would fabricate lifecycle health. The
// cross-language RPC smoke covers the authenticated handshake; native release
// verification starts this staged host through HopperCode inside Rhino.
console.log(`[hopper-pi] Staged host modules, native ZeroMQ, and esbuild loaded with external Node ${nodeVersion}`);
