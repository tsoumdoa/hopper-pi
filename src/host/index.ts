import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveHostConfig } from "./config.js";
import { watchParentProcess } from "./lifecycle.js";
import { EmbeddedPiHost } from "./pi-runtime.js";
import { startHopperServer, type HopperServer, validateStaticDirectory } from "./server.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
	const modulePath = fileURLToPath(import.meta.url);
	const config = resolveHostConfig(args, { moduleDir: dirname(modulePath) });
	validateStaticDirectory(config.paths.staticDir);
	if (config.connectionProfile) process.env.HOPPER_CONNECTION_PROFILE = config.connectionProfile;

	let runtime: EmbeddedPiHost | undefined;
	let server: HopperServer | undefined;
	let stopParentWatcher = () => {};
	let shutdownPromise: Promise<void> | undefined;

	const shutdown = () => {
		if (shutdownPromise) return shutdownPromise;
		const forceExit = setTimeout(() => process.exit(process.exitCode ?? 0), 5_000);
		shutdownPromise = (async () => {
			stopParentWatcher();
			await server?.close();
			await runtime?.dispose();
		})().then(() => {
			clearTimeout(forceExit);
		}).catch((error) => {
			process.stderr.write(`[hopper-host] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
		return shutdownPromise;
	};

	try {
		runtime = await EmbeddedPiHost.create({
			paths: config.paths,
			onShutdownRequest: () => { void shutdown(); },
		});
		server = await startHopperServer({
			runtime,
			staticDir: config.paths.staticDir,
			port: config.port,
			onShutdownRequest: () => { void shutdown(); },
		});
	} catch (error) {
		process.exitCode = 1;
		process.stderr.write(`[hopper-host] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		await shutdown();
		return;
	}
	stopParentWatcher = watchParentProcess(config.parentPid, () => { void shutdown(); });

	process.once("SIGINT", () => { void shutdown(); });
	process.once("SIGTERM", () => { void shutdown(); });
	process.stdout.write(`${JSON.stringify({ type: "ready", url: server.url, pid: process.pid })}\n`);
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
