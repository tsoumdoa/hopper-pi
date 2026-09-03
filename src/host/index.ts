import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveHostConfig } from "./config.js";
import { HostShutdownCoordinator, watchParentProcess } from "./lifecycle.js";
import { EmbeddedPiHost } from "./pi-runtime.js";
import { startHopperServer, type HopperServer, validateStaticDirectory } from "./server.js";
import { closeRuntimeRpc, getRuntimeRpc } from "../infra/runtime-rpc.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
	const modulePath = fileURLToPath(import.meta.url);
	const config = resolveHostConfig(args, { moduleDir: dirname(modulePath) });
	validateStaticDirectory(config.paths.staticDir);
	if (config.connectionProfile) process.env.HOPPER_CONNECTION_PROFILE = config.connectionProfile;

	let runtime: EmbeddedPiHost | undefined;
	let server: HopperServer | undefined;
	let stopParentWatcher = () => {};
	let unsubscribeRuntimeNotices = () => {};
	const shutdown = new HostShutdownCoordinator({
		cleanup: async () => {
			stopParentWatcher();
			await server?.close();
			unsubscribeRuntimeNotices();
			await runtime?.dispose();
			await closeRuntimeRpc();
		},
		exit: (code) => process.exit(code),
		getExitCode: () => typeof process.exitCode === "number"
			? process.exitCode
			: Number(process.exitCode ?? 0),
		setExitCode: (code) => { process.exitCode = code; },
		reportError: (error) => {
			process.stderr.write(`[hopper-host] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
		},
	});
	stopParentWatcher = watchParentProcess(config.parentPid, () => {
		void shutdown.request("parent_gone");
	});

	try {
		const runtimeRpc = getRuntimeRpc();
		const protocolHandshake = await runtimeRpc.connect();
		if (!protocolHandshake.protocolHandshakeLive
			|| protocolHandshake.lifecycleInstanceId !== runtimeRpc.lifecycleInstanceId) {
			throw new Error("RPC handshake is not live for the current lifecycle instance");
		}
		runtime = await EmbeddedPiHost.create({
			paths: config.paths,
			onShutdownRequest: () => { void shutdown.request("normal"); },
		});
		unsubscribeRuntimeNotices = runtimeRpc.subscribeNotices((notice) => {
			runtime?.bus.publish({
				type: "ui_notification",
				message: notice.message,
				level: notice.level,
			});
		});
		server = await startHopperServer({
			runtime,
			staticDir: config.paths.staticDir,
			port: config.port,
			protocolHandshake,
			getRuntimeStatus: (completionTimeoutMs = 8_000) => runtimeRpc.getRuntimeStatus(completionTimeoutMs),
			onShutdownRequest: () => { void shutdown.request("normal"); },
		});
	} catch (error) {
		process.exitCode = 1;
		process.stderr.write(`[hopper-host] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		await shutdown.request("normal");
		return;
	}
	process.once("SIGINT", () => { void shutdown.request("normal"); });
	process.once("SIGTERM", () => { void shutdown.request("normal"); });
	process.stdout.write(`${JSON.stringify({
		type: "ready",
		url: server.url,
		pid: process.pid,
		lifecycleInstanceId: server.lifecycleInstanceId,
		protocolHandshakeLive: server.protocolHandshakeLive,
	})}\n`);
}

const isEntrypoint = process.argv[1]
	? realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
	: false;

if (isEntrypoint) {
	main().catch((error) => {
		process.stderr.write(`[hopper-host] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
