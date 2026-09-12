import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProxyOptions } from "vite";

export function hostProxyTarget(): string {
	if (process.env.HOPPER_UI_PROXY_TARGET) return process.env.HOPPER_UI_PROXY_TARGET;
	try {
		const state = JSON.parse(readFileSync(join(homedir(), ".hopper", "shared-control", "control.json"), "utf8"));
		const port = state?.endpointPort;
		if (Number.isSafeInteger(port) && port > 0 && port <= 65535) return `http://127.0.0.1:${port}`;
	} catch {
		// A dev server may start before the shared host has assigned its endpoint.
	}
	return "http://127.0.0.1:1";
}

export function sharedHostProxy(resolveTarget = hostProxyTarget): ProxyOptions {
	return {
		target: resolveTarget(),
		ws: true,
		configure(_proxy, options) {
			// Vite calls bypass for HTTP and WebSocket upgrades. Refresh the proxy's
			// own options too: upgrades use proxy.ws without per-request options.
			options.bypass = (_request, _response, requestOptions) => {
				const target = resolveTarget();
				options.target = target;
				requestOptions.target = target;
			};
		},
	};
}
