import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveHostConfig } from "./config.js";
import { validateStaticDirectory } from "./server.js";
import { startSharedHost } from "./shared/main.js";

export async function main(args = process.argv.slice(2)): Promise<void> {
	const modulePath = fileURLToPath(import.meta.url);
	const config = resolveHostConfig(args, { moduleDir: dirname(modulePath) });
	validateStaticDirectory(config.paths.staticDir);
	await startSharedHost(config, args, modulePath);
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
