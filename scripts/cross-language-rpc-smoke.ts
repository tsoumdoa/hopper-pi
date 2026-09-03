import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { HopperRpcClient, type RpcCallResult } from "../src/infra/rpc-client.js";

const label = "[cross-language-rpc]";
const project = resolve("dotnet/Hopper.CrossLanguageRpcHost/Hopper.CrossLanguageRpcHost.csproj");
const assembly = resolve("dotnet/Hopper.CrossLanguageRpcHost/bin/Release/net8.0/Hopper.CrossLanguageRpcHost.dll");

const probe = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
if (probe.error && "code" in probe.error && probe.error.code === "ENOENT") {
	console.log(`${label} SKIP: .NET SDK 8.0 or newer is required for the C# transport host.`);
	process.exit(0);
}
if (probe.status !== 0) {
	throw new Error(`Could not inspect the .NET SDK: ${probe.stderr || probe.error?.message || "unknown error"}`);
}
const dotnetMajor = Number.parseInt(probe.stdout.trim().split(".")[0] ?? "", 10);
if (!Number.isInteger(dotnetMajor) || dotnetMajor < 8) {
	console.log(`${label} SKIP: .NET SDK 8.0 or newer is required. Found ${probe.stdout.trim() || "an unknown version"}.`);
	process.exit(0);
}

const build = spawnSync("dotnet", [
	"build",
	project,
	"--configuration", "Release",
	"--nologo",
	"--verbosity", "quiet",
], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
if (build.status !== 0) throw new Error(`C# smoke host build failed with exit code ${build.status ?? "unknown"}.`);

let host: ChildProcessWithoutNullStreams | undefined;
let client: HopperRpcClient | undefined;
let requestedShutdown = false;

try {
	host = spawn("dotnet", [assembly], { stdio: ["pipe", "pipe", "pipe"] });
	let hostErrors = "";
	host.stderr.setEncoding("utf8");
	host.stderr.on("data", (chunk: string) => { hostErrors += chunk; });
	const ready = await readReadyLine(host, () => hostErrors);

	const requestIds = ["request-handshake", "request-query", "request-mutation"];
	client = new HopperRpcClient({
		endpoint: ready.routerEndpoint,
		lifecycleInstanceId: ready.lifecycleInstanceId,
		token: ready.token,
		identity: "node-cross-language-smoke",
		requestIdFactory: () => requestIds.shift() ?? "request-unexpected",
		operationIdFactory: () => "operation-mutation",
		defaultStartDeadlineMs: 5_000,
		defaultCompletionTimeoutMs: 5_000,
	});

	const handshake = expectRhinoResponse(await client.call("lifecycleHandshake", {
		nodeProcessId: process.pid,
		nodeVersion: process.version,
		clientIdentity: client.identity,
	}));
	assert.equal(handshake.requestId, "request-handshake");
	assert.equal(handshake.operation, "lifecycleHandshake");
	assert.equal(handshake.result.class, "completed");
	assert.deepEqual(handshake.result.data, { handshake: "live", statusRevision: 91 });

	const queryPending = client.call("queryRhinoObjects", { objectType: "curve" });
	const mutationPending = client.call(
		"setSliderValue",
		{ targetId: "slider-1", value: 4.25 },
		{ operationId: "operation-mutation" },
	);
	const [query, mutation] = (await Promise.all([queryPending, mutationPending])).map(expectRhinoResponse);

	assert.equal(query.requestId, "request-query");
	assert.equal(query.operation, "queryRhinoObjects");
	assert.deepEqual(query.result.data, {
		operation: "queryRhinoObjects",
		requestId: "request-query",
		operationId: null,
		args: { objectType: "curve" },
	});
	assert.equal(mutation.requestId, "request-mutation");
	assert.equal(mutation.operation, "setSliderValue");
	assert.equal(mutation.operationId, "operation-mutation");
	assert.deepEqual(mutation.result.data, {
		operation: "setSliderValue",
		requestId: "request-mutation",
		operationId: "operation-mutation",
		args: { targetId: "slider-1", value: 4.25 },
	});

	await client.close();
	client = undefined;
	const exited = waitForExit(host, 3_000);
	host.stdin.end("shutdown\n");
	requestedShutdown = true;
	const exit = await exited;
	assert.equal(exit.code, 0, `C# smoke host failed. ${hostErrors.trim()}`);
	console.log(`${label} PASS: authenticated handshake, query, and mutation matched across C# and TypeScript.`);
} finally {
	await client?.close();
	if (host && host.exitCode === null && !requestedShutdown) host.stdin.end("shutdown\n");
	if (host && host.exitCode === null) {
		try {
			await waitForExit(host, 3_000);
		} catch {
			host.kill();
		}
	}
}

function expectRhinoResponse(result: RpcCallResult): Exclude<RpcCallResult, { source: "node" }> {
	if ("source" in result) throw new Error(`Unexpected Node-local result for ${result.operation}.`);
	assert.equal(result.result.class, "completed");
	assert.equal(result.result.reasonCode, "OK");
	return result;
}

type ReadyMessage = {
	type: "ready";
	routerEndpoint: string;
	lifecycleInstanceId: string;
	token: string;
};

function readReadyLine(
	host: ChildProcessWithoutNullStreams,
	readErrors: () => string,
): Promise<ReadyMessage> {
	return new Promise((accept, reject) => {
		const lines = createInterface({ input: host.stdout });
		const timer = setTimeout(() => finish(new Error("C# smoke host did not report ready within ten seconds.")), 10_000);
		const onExit = (code: number | null) => finish(new Error(
			`C# smoke host exited before ready with code ${code ?? "unknown"}. ${readErrors().trim()}`,
		));
		const finish = (error?: Error, ready?: ReadyMessage) => {
			clearTimeout(timer);
			host.off("exit", onExit);
			lines.close();
			if (error) reject(error);
			else accept(ready!);
		};
		host.once("exit", onExit);
		lines.once("line", (line) => {
			try {
				const ready = JSON.parse(line) as ReadyMessage;
				assert.equal(ready.type, "ready");
				finish(undefined, ready);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}

function waitForExit(
	host: ChildProcessWithoutNullStreams,
	timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	if (host.exitCode !== null) return Promise.resolve({ code: host.exitCode, signal: null });
	return new Promise((accept, reject) => {
		const timer = setTimeout(() => {
			host.off("exit", onExit);
			reject(new Error(`C# smoke host did not exit within ${timeoutMs}ms.`));
		}, timeoutMs);
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timer);
			accept({ code, signal });
		};
		host.once("exit", onExit);
	});
}
