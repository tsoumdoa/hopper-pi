import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

// Rhino can be closed while its detached host still runs the previous package.
export async function stopSharedHost(directory = join(userInfo().homedir, ".hopper", "shared-control")) {
	let discovery;
	try {
		discovery = JSON.parse(await readFile(join(directory, "discovery.json"), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	const { pid, endpointPort, hostEpoch, processStartIdentity } = discovery;
	if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid ||
		!Number.isSafeInteger(endpointPort) || endpointPort < 1 || endpointPort > 65535 ||
		typeof hostEpoch !== "string" || !hostEpoch ||
		typeof processStartIdentity !== "string" || !processStartIdentity)
		throw new Error("Invalid shared host discovery; package replacement cancelled.");
	if (!isRunning(pid)) return;
	const response = await fetch(`http://127.0.0.1:${endpointPort}/api/shared/health`, {
		signal: AbortSignal.timeout(3000), redirect: "error",
	});
	const health = await response.json();
	if (!response.ok || !health.ready || health.pid !== pid ||
		health.hostEpoch !== hostEpoch || health.processStartIdentity !== processStartIdentity)
		throw new Error("Could not verify the running shared host; package replacement cancelled.");

	console.log("[hopper-pi] Waiting for the previous background host to stop before replacing its files");
	// Windows SIGTERM forcibly terminates Node without running cleanup. With
	// Rhino closed, the shared host exits itself after its normal lifecycle drain.
	if (process.platform !== "win32") {
		try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
	const deadline = Date.now() + 30_000;
	while (isRunning(pid)) {
		if (Date.now() >= deadline)
			throw new Error("Shared host did not exit within 30 seconds; package replacement cancelled. Stop Hopper and retry.");
		await delay(100);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	stopSharedHost().catch((error) => {
		console.error(`[hopper-pi] ${error.message}`);
		process.exitCode = 1;
	});
}
