#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	if (index === -1) return fallback;
	if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
	return args[index + 1];
};
if (args.includes("--help")) {
	console.log("Usage: node scripts/benchmark-host-startup.mjs --entry <packaged host/index.js> [--copy-root <runtime/host directory>] [--node <node executable>] [--runs 3] [--timeout-ms 60000] [--output report.json]");
	console.log("Each run uses a fresh process and isolated temporary home/data. Filesystem caches are NOT cleared; this is not a cold-boot benchmark.");
	console.log("--copy-root copies that tree to a fresh path before each timed launch; it must contain the entry and its dependencies.");
	process.exit(0);
}
for (let index = 0; index < args.length; index++) {
	if (!["--entry", "--copy-root", "--node", "--runs", "--timeout-ms", "--output"].includes(args[index])) throw new Error(`Unknown option: ${args[index]}`);
	option(args[index]);
	index++;
}
const entryOption = option("--entry");
if (!entryOption) throw new Error("--entry is required; point it at the packaged host/index.js");
const entry = resolve(entryOption);
const copyRootOption = option("--copy-root");
const copyRoot = copyRootOption ? await realpath(resolve(copyRootOption)) : null;
const copiedEntry = copyRoot ? relative(copyRoot, await realpath(entry)) : null;
const inside = path => path !== "" && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\") && !isAbsolute(path);
if (copyRoot && !inside(copiedEntry)) throw new Error("--copy-root must contain --entry");
const executable = option("--node", process.execPath);
const runs = Number(option("--runs", "3"));
const timeout = Number(option("--timeout-ms", "60000"));
if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(timeout) || timeout < 1) throw new Error("runs and timeout-ms must be positive integers");
await readFile(entry);
// Do not fall back to a fake page: this also checks the packaged static directory.
await readFile(join(dirname(entry), "static", "index.html"));

function http(port, path = "/health", method = "GET", headers = {}) {
	return new Promise((resolveHealth) => {
		const req = request({ hostname: "127.0.0.1", port, path, method, headers, timeout: 250 }, response => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", chunk => { body += chunk; });
			response.on("end", () => {
				resolveHealth({ status: response.statusCode, body });
			});
		});
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolveHealth(null));
		req.end();
	});
}

async function benchmark(run) {
	const root = await mkdtemp(join(tmpdir(), "hopper-startup-benchmark-"));
	let child;
	let exited;
	let interrupted = false;
	const interrupt = () => { interrupted = true; };
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	try {
		let runEntry = entry;
		if (copyRoot) {
			const temporaryPath = relative(copyRoot, await realpath(root));
			if (!temporaryPath || inside(temporaryPath))
				throw new Error("--copy-root must not contain the benchmark temporary directory");
			await cp(copyRoot, join(root, "package"), { recursive: true, errorOnExist: true, force: false });
			runEntry = join(root, "package", copiedEntry);
		}
		const home = join(root, "home");
		const data = join(root, "data");
		const workspace = join(root, "workspace");
		await Promise.all([home, data, workspace, join(root, "tools")].map(path => mkdir(path, { recursive: true })));
		// --data-dir alone does NOT isolate SharedHostControl, which uses userInfo().
		// Patch both home APIs before any host import, retaining the real username
		// so Windows ACLs still apply to the invoking account. This works on older
		// installed bundles too, without introducing a production override.
		const preload = join(root, "isolate.mjs");
		await writeFile(preload, `import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
const originalUserInfo = os.userInfo;
const home = ${JSON.stringify(home)};
os.homedir = () => home;
os.userInfo = options => ({ ...originalUserInfo(options), homedir: options?.encoding === "buffer" ? Buffer.from(home) : home });
syncBuiltinESMExports();
`);
		// Inherit only operating-system essentials, never provider credentials,
		// NODE_OPTIONS, Pi extensions, or Hopper path overrides from the user.
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|pathext|temp|tmp|lang|lc_all)$/i.test(key)));
		Object.assign(env, {
			HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"),
			LOCALAPPDATA: join(home, "AppData", "Local"), XDG_CONFIG_HOME: join(home, ".config"),
			XDG_DATA_HOME: join(home, ".local", "share"), PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
		});
		const started = performance.now();
		const elapsed = () => Math.round(performance.now() - started);
		const result = { run, listeningMs: null, firstHealthMs: null, readyMs: null, runtimeModulesMs: null, stages: [] };
		let stderr = "";
		let pending = "";
		let exitCode;
		child = spawn(executable, ["--import", pathToFileURL(preload).href, runEntry, "--explicit-start", "--data-dir", data,
			"--auth-path", join(home, "auth.json"), "--tool-config-dir", join(root, "tools"), "--script-workspace", workspace],
			{ cwd: workspace, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
		exited = new Promise(resolveExit => {
			child.once("error", error => { exitCode = error.message; resolveExit(); });
			child.once("exit", code => { exitCode = code ?? "signal"; resolveExit(); });
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", chunk => {
			stderr = (stderr + chunk).slice(-16000);
			pending += chunk;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop();
			for (const line of lines) {
				const match = line.match(/startup: (.+) \((\d+) ms elapsed\)/);
				if (!match) continue;
				result.stages.push({ stage: match[1], hostElapsedMs: Number(match[2]), processElapsedMs: elapsed() });
				if (match[1].startsWith("browser listening")) result.listeningMs ??= elapsed();
			}
		});
		let discovery;
		while (elapsed() < timeout) {
			if (interrupted) throw new Error("Startup benchmark interrupted");
			if (exitCode !== undefined) throw new Error(`Host exited (${exitCode}) before readiness:\n${stderr}`);
			if (!discovery) {
				try { discovery = JSON.parse(await readFile(join(home, ".hopper", "shared-control", "discovery.json"), "utf8")); }
				catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
				if (discovery && discovery.pid !== child.pid) throw new Error("Isolation failed: discovery PID does not belong to the benchmark child");
			}
			if (discovery) {
				const received = await http(discovery.endpointPort);
				let response;
				try { response = received?.status === 200 ? JSON.parse(received.body) : null; } catch {}
				if (response && response.pid === child.pid && response.hostEpoch === discovery.hostEpoch) {
					result.firstHealthMs ??= elapsed();
					if (response.ready) { result.readyMs = elapsed(); break; }
				}
			}
			await delay(25);
		}
		if (result.readyMs === null) throw new Error(`Host did not become ready in ${timeout} ms:\n${stderr}`);
		const start = result.stages.find(item => item.stage.includes("loading runtime modules"));
		const end = result.stages.find(item => item.stage.startsWith("opening journal"));
		if (start && end) result.runtimeModulesMs = end.hostElapsedMs - start.hostElapsedMs;
		return result;
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
		if (child && child.exitCode === null && child.signalCode === null) child.kill();
		if (exited) {
			await Promise.race([exited, delay(3000, undefined, { ref: false })]);
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited;
		}
		// root is exclusively the path returned by mkdtemp above. No user-selected
		// directory or discovered host data path is ever passed to recursive removal.
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}

const results = [];
for (let run = 1; run <= runs; run++) {
	const result = await benchmark(run);
	results.push(result);
	console.error(`Run ${run}: listening ${result.listeningMs} ms; first health ${result.firstHealthMs} ms; ready ${result.readyMs} ms; runtime modules ${result.runtimeModulesMs} ms`);
}
const report = { entry, copyRoot, executable, platform: process.platform, recordedAt: new Date().toISOString(),
	cacheCondition: copyRoot
		? "Fresh package path, process and empty isolated data for every run; copying excluded from timing. OS filesystem cache uncontrolled; not reboot-cold."
		: "Fresh processes and empty isolated data; OS filesystem cache uncontrolled. First run is not necessarily cold.",
	pollIntervalMs: 25, requestTimeoutMs: 250, results };
const json = `${JSON.stringify(report, null, 2)}\n`;
const output = option("--output");
if (output) await writeFile(resolve(output), json);
process.stdout.write(json);
