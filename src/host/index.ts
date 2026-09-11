import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveHostConfig } from "./config.js";
import { validateStaticDirectory } from "./server.js";
import { SharedHostControl } from "./shared/control.js";
import { ensureSharedHost } from "./shared/ensure-host.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
	const modulePath = fileURLToPath(import.meta.url);
	const config = resolveHostConfig(args, { moduleDir: dirname(modulePath) });
	validateStaticDirectory(config.paths.staticDir);
	if (["--parent-pid", "--instance-id", "--connection-profile"].some(arg => args.includes(arg)))
		throw new Error("Hopper uses one persistent host; per-process host options are no longer supported");
	if (args.includes("--ensure-host")) {
		// Keep native launches and browser reopens independent of the host's runtime imports.
		const discovery = await ensureSharedHost({
			control: new SharedHostControl(),
			defaultDataDirectory: join(config.paths.dataDir, "shared-host"),
			dataDirectory: args.includes("--data-dir") ? join(config.paths.dataDir, "shared-host") : undefined,
			explicitStart: args.includes("--explicit-start"),
			entrypoint: modulePath,
			hostArguments: args.filter(arg => !["--ensure-host", "--explicit-start"].includes(arg)),
			onBrowserReady: host => process.stdout.write(`${JSON.stringify({ type: "shared_browser_ready", hostEpoch: host.hostEpoch, port: host.endpointPort })}\n`),
		});
		process.stdout.write(`${JSON.stringify({ type: "shared_ready", hostEpoch: discovery.hostEpoch, port: discovery.endpointPort })}\n`);
		return;
	}
	const { startSharedHost } = await import("./shared/main.js");
	await startSharedHost(config, args);
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
