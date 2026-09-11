import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import {
	SharedHostControl,
	type ControlState,
	type HostDiscovery,
} from "./control.js";

export interface EnsureSharedHostOptions {
	control: SharedHostControl;
	defaultDataDirectory: string;
	dataDirectory?: string;
	explicitStart?: boolean;
	entrypoint: string;
	hostArguments?: string[];
	timeoutMs?: number;
	onBrowserReady?: (discovery: HostDiscovery) => void;
	/** Test seam; production always uses a detached structured spawn. */
	spawnHost?: (state: ControlState) => Promise<void>;
}
/** Short-lived native launcher. Ownership remains with the independent host's bound HTTP server. */
export async function ensureSharedHost(
	options: EnsureSharedHostOptions,
): Promise<HostDiscovery> {
	const state = await options.control.initialize(options);
	if (state.desiredState !== "running")
		throw new Error(
			"Shared host was intentionally stopped; run HopperCode explicitly to start it",
		);
	let announcedEpoch: string | undefined;
	const browserReady = (discovery: HostDiscovery) => {
		if (announcedEpoch === discovery.hostEpoch) return;
		announcedEpoch = discovery.hostEpoch;
		options.onBrowserReady?.(discovery);
	};
	const existing = await healthyDiscovery(options.control, state, browserReady);
	if (existing) return existing;
	// Cold SDK loading and journal migrations can outlast the old 15-second limit.
	// Keep this below SharedNodeAttachment's outer launcher deadline (75 seconds).
	const timeoutMs = options.timeoutMs ?? 60_000;
	const deadline = Date.now() + timeoutMs;
	if (await endpointOccupied(state.endpointPort)) {
		const previous = options.control.readDiscovery();
		const draining =
			options.explicitStart &&
			previous &&
			previous.revision < state.revision &&
			(await healthyDiscovery(options.control, {
				...state,
				revision: previous.revision,
			}));
		// Another Rhino may have started the winner, which binds the endpoint
		// before loading its runtime and publishing discovery. Wait for verified
		// readiness without spawning or replacing that owner.
		while (await endpointOccupied(state.endpointPort)) {
			const current = await options.control.snapshot();
			if (
				!current ||
				current.desiredState !== "running" ||
				current.revision !== state.revision
			)
				throw new Error("Shared startup was superseded by newer host intent");
			const replacement = await healthyDiscovery(options.control, state, browserReady);
			if (replacement) return replacement;
			if (Date.now() >= deadline)
				throw new Error(
					draining
						? "Previous shared host is still draining or hung; inspect its owner manually. No fallback host was started"
						: `Shared endpoint ${state.endpointPort} is occupied but has no compatible healthy host; inspect or restart its owner manually. No fallback host was started`,
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	const current = await options.control.snapshot();
	if (
		!current ||
		current.desiredState !== "running" ||
		current.revision !== state.revision
	)
		throw new Error("Shared startup was superseded by newer host intent");
	if (options.spawnHost) await options.spawnHost(state);
	else {
		const log = openSync(
			join(options.control.directory, "host.log"),
			"a",
			0o600,
		);
		try {
			await new Promise<void>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					[options.entrypoint, ...(options.hostArguments ?? [])],
					{
						detached: true,
						stdio: ["ignore", log, log],
						shell: false,
						windowsHide: true,
					},
				);
				child.once("error", reject);
				child.once("spawn", () => {
					child.unref();
					resolve();
				});
			});
		} finally {
			closeSync(log);
		}
	}
	while (Date.now() < deadline) {
		const current = await options.control.snapshot();
		if (
			!current ||
			current.desiredState !== "running" ||
			current.revision !== state.revision
		)
			throw new Error("Shared startup was superseded by newer host intent");
		const discovery = await healthyDiscovery(options.control, state, browserReady);
		if (discovery) return discovery;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Shared host did not become ready within ${timeoutMs / 1000} seconds; inspect startup stages in its private host.log. No fallback host was started`,
	);
}
async function healthyDiscovery(
	control: SharedHostControl,
	state: ControlState,
	onBrowserReady?: (discovery: HostDiscovery) => void,
): Promise<HostDiscovery | null> {
	const discovery = control.readDiscovery();
	if (!discovery) return null;
	if (
		discovery.endpointPort !== state.endpointPort ||
		discovery.dataDirectory !== state.dataDirectory ||
		discovery.journalIdentity !== state.journalIdentity
	)
		throw new Error("Shared discovery storage/endpoint conflict");
	// An old publication can remain after an intentional stop; wait for the new revision.
	if (discovery.revision !== state.revision) return null;
	if (discovery.protocolVersion !== 2 || discovery.schemaVersion !== 2)
		throw new Error(
			`Shared host protocol/schema ${discovery.protocolVersion}/${discovery.schemaVersion} is incompatible; stop/update/restart explicitly`,
		);
	try {
		const response = await fetch(
			`http://127.0.0.1:${state.endpointPort}/api/shared/health`,
			{ signal: AbortSignal.timeout(750), redirect: "error" },
		);
		if (!response.ok) return null;
		const health = (await response.json()) as Partial<HostDiscovery> & { ready?: boolean; listening?: boolean };
		const verified = health.hostEpoch === discovery.hostEpoch &&
			health.protocolVersion === discovery.protocolVersion &&
			health.schemaVersion === discovery.schemaVersion &&
			health.journalIdentity === state.journalIdentity &&
			health.dataDirectory === state.dataDirectory;
		if (verified && (health.listening || health.ready)) onBrowserReady?.(discovery);
		return verified && health.ready === true ? discovery : null;
	} catch {
		return null;
	}
}
function endpointOccupied(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const finish = (occupied: boolean) => {
			socket.destroy();
			resolve(occupied);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.setTimeout(750, () => finish(true));
	});
}
