#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
async function hostModules(directory) {
	const modules = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === "static") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) modules.push(...await hostModules(path));
		else if (entry.name.endsWith(".js")) modules.push(pathToFileURL(path).href);
	}
	return modules;
}
const moduleUrls = await hostModules(dirname(hostEntry));
const smokeDirectory = await mkdtemp(join(tmpdir(), "hopper-staged-smoke-"));
const smokeSource = [
	`await import(${JSON.stringify(pathToFileURL(hostEntry).href)});`,
	`const hostModules = await Promise.all(${JSON.stringify(moduleUrls)}.map(url => import(url)));`,
	`const EmbeddedPiHost = hostModules.find(module => module.EmbeddedPiHost)?.EmbeddedPiHost;`,
	`if (!EmbeddedPiHost) throw new Error("Bundled EmbeddedPiHost export is missing");`,
	`await import("zeromq");`,
	`await import("@napi-rs/keyring");`,
	`const { hostProjectRoot } = await import(${JSON.stringify(pathToFileURL(join(dirname(hostEntry), "runtime-paths.js")).href)});`,
	`const { realpathSync } = await import("node:fs");`,
	`if (realpathSync(hostProjectRoot()) !== realpathSync(process.cwd())) throw new Error("Bundled skills root is incorrect");`,
	`const { access, writeFile } = await import("node:fs/promises");`,
	`const { join } = await import("node:path");`,
	`await access(join(hostProjectRoot(), "mds/skills"));`,
	`const piRoot = new URL("./", import.meta.resolve("@earendil-works/pi-coding-agent"));`,
	`const pi = await import("@earendil-works/pi-coding-agent");`,
	`const duplicateEntry = await import(new URL("bundle/index.js", piRoot));`,
	`if (duplicateEntry.ModelRuntime !== pi.ModelRuntime) throw new Error("Pi SDK bundle still duplicates module state");`,
	`const temporary = ${JSON.stringify(smokeDirectory)};`,
	`const embedded = await EmbeddedPiHost.create({ probeBackend: false, paths: { dataDir: join(temporary, "host"), agentDir: join(temporary, "host/agent"), authPath: join(temporary, "host/auth.json"), sessionsDir: join(temporary, "host/sessions"), workspaceDir: join(temporary, "host/workspace"), toolConfigDir: join(temporary, "tools"), staticDir: join(hostProjectRoot(), "dist/host/static") } });`,
	`try {`,
	` const skills = await embedded.listSkills();`,
	` if (!skills.skills?.length) throw new Error("Bundled Hopper skills were not loaded");`,
	` if (!embedded.snapshot().sessionId) throw new Error("Bundled Hopper session was not created");`,
	` await embedded.newSession();`,
	`} finally { await embedded.dispose(); }`,
	` const extension = join(temporary, "extension.ts");`,
	` await writeFile(extension, 'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"; import { Type } from "typebox"; export default (pi: ExtensionAPI) => { pi.registerTool({ name: "staged_smoke", label: "Smoke", description: "Smoke", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) }); };');`,
	` const { loadExtensions } = await import(new URL("core/extensions/loader.js", piRoot));`,
	` const loaded = await loadExtensions([extension], temporary);`,
	` if (loaded.errors.length || !loaded.extensions[0]?.tools.has("staged_smoke")) throw new Error("Dynamic TypeScript extension failed: " + JSON.stringify(loaded.errors));`,
	` const services = await pi.createAgentSessionServices({ cwd: temporary, agentDir: join(temporary, "agent"), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true } });`,
	` const { session } = await pi.createAgentSessionFromServices({ services, sessionManager: pi.SessionManager.inMemory(temporary), noTools: true });`,
	` if (!session.agent) throw new Error("Pi session creation failed");`,
	` session.dispose();`,
	` const { resizeImage } = await import(new URL("utils/image-resize.js", piRoot));`,
	` const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=", "base64");`,
	` const { Worker } = await import("node:worker_threads");`,
	` const worker = new Worker(new URL("utils/image-resize-worker.js", piRoot), { execArgv: [] });`,
	` try {`,
	`  const message = new Promise((accept, reject) => { worker.once("message", accept); worker.once("error", reject); worker.once("exit", code => reject(new Error("Image worker exited before responding: " + code))); });`,
	`  worker.postMessage({ inputBytes: new Uint8Array(png), mimeType: "image/png", options: { maxWidth: 1, maxHeight: 1 } });`,
	`  const response = await message;`,
	`  if (response.error || response.result?.width !== 1) throw new Error("Direct image worker failed: " + JSON.stringify(response));`,
	` } finally { await worker.terminate(); }`,
	` const resized = await resizeImage(png, "image/png", { maxWidth: 1, maxHeight: 1 });`,
	` if (!resized || resized.width !== 1 || resized.height !== 1) throw new Error("Pi image worker/WASM failed");`,
	`const { TaskJournal } = await import(${JSON.stringify(pathToFileURL(join(dirname(hostEntry), "shared", "journal.js")).href)});`,
	`const journal = new TaskJournal(":memory:");`,
	`journal.registerSession("smoke-conversation", "smoke-session");`,
	`const submission = { requestId: "smoke", conversationId: "smoke-conversation", sessionId: "smoke-session", kind: "prompt", text: "smoke", bindings: [], attachments: [] };`,
	`const receipt = journal.accept(submission);`,
	`if (journal.accept(submission).taskId !== receipt.taskId) throw new Error("SQLite acceptance deduplication failed");`,
	`journal.close();`,
	`const esbuild = await import("esbuild");`,
	`await esbuild.transform("const value: number = 1", { loader: "ts" });`,
	`process.stdout.write(process.version);`,
].join("\n");
let nodeVersion;
try {
	const child = spawn(nodeExecutable, ["--input-type=module", "--eval", smokeSource], {
		cwd: hostDirectory,
		env: { ...process.env, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_CODING_AGENT_DIR: join(smokeDirectory, "global-agent") },
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });

	const exitCode = await new Promise((accept, reject) => {
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, 30_000);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (timedOut) reject(new Error("Staged runtime import timed out after 30 seconds."));
			else accept(code);
		});
	});

	if (exitCode !== 0) {
		throw new Error(`Staged runtime import failed with exit code ${exitCode ?? "unknown"}. ${stderr.trim()}`);
	}
	nodeVersion = stdout.trim();
	const versionMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
	const version = versionMatch?.slice(1).map(Number);
	if (!version || version[0] < 22 || (version[0] === 22 && version[1] < 19)) {
		throw new Error(`Staged runtime smoke requires stable Node 22.19.0 or newer; found ${nodeVersion || "no version"}.`);
	}

} finally {
	await rm(smokeDirectory, { recursive: true, force: true });
}

// Starting the HTTP host without Rhino would fabricate lifecycle health. The
// cross-language RPC smoke covers the authenticated handshake; native release
// verification starts this staged host through HopperCode inside Rhino.
console.log(`[hopper-pi] All staged host chunks, Hopper and Pi sessions, TS extension, image processing, native bindings, SQLite journal, and esbuild loaded with external Node ${nodeVersion}`);
