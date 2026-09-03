#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const stage = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: smoke-staged-host.mjs <staging-directory>");
const runtimeDirectory = join(stage, "runtime");
const manifest = JSON.parse(await readFile(join(runtimeDirectory, "hopper-runtime.json"), "utf8"));
const nodeExecutable = process.env.HOPPER_NODE_EXECUTABLE || process.execPath;
const hostEntry = resolve(runtimeDirectory, manifest.hostEntry ?? "");
const dataDirectory = await mkdtemp(join(tmpdir(), "hopper-stage-smoke-"));
const child = spawn(nodeExecutable, [
	hostEntry,
	"--port", "0",
	"--data-dir", dataDirectory,
	"--instance-id", "package-smoke",
	"--parent-pid", String(process.pid),
], {
	cwd: dirname(dirname(dirname(hostEntry))),
	stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
let stdout = "";
child.stderr.setEncoding("utf8");
child.stdout.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
	const ready = await new Promise((resolveReady, reject) => {
		const timeout = setTimeout(() => reject(new Error(`Timed out waiting for staged host. ${stderr}`)), 70_000);
		child.once("exit", (code) => reject(new Error(`Staged host exited ${code}. ${stderr}`)));
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			const lineEnd = stdout.indexOf("\n");
			if (lineEnd === -1) return;
			try {
				const message = JSON.parse(stdout.slice(0, lineEnd));
				if (message.type !== "ready") return;
				clearTimeout(timeout);
				resolveReady(message);
			} catch {
				// Keep waiting for a valid readiness line.
			}
		});
	});
	const url = new URL(ready.url);
	const token = url.hash.slice(1);
	const origin = url.origin;
	const health = await fetch(`${origin}/health`);
	if (!health.ok) throw new Error(`Staged host health returned ${health.status}`);
	const exited = new Promise((resolveExit, reject) => {
		const timeout = setTimeout(() => reject(new Error("Staged host did not exit after shutdown")), 8_000);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			if (code === 0) resolveExit();
			else reject(new Error(`Staged host exited ${code}. ${stderr}`));
		});
	});
	const shutdown = await fetch(`${origin}/api/shutdown`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!shutdown.ok) throw new Error(`Staged host shutdown returned ${shutdown.status}`);
	await exited;
	console.log(`[hopper-pi] Staged host smoke passed with external Node ${process.version}`);
} finally {
	if (child.exitCode == null) child.kill("SIGKILL");
	await rm(dataDirectory, { recursive: true, force: true });
}
