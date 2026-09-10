import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TargetBinding } from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";
import { validateTargetBinding } from "../../protocol/shared-execution.js";

export interface ProcessIdentity {
	pid: number;
	startIdentity: string;
}
export interface LaunchRequest {
	requestId: string;
	rootTaskId: string;
	installationId: string;
	independentProcess: boolean;
	intentRevision: number;
}
export interface LaunchGrant {
	grantId: string;
	rootTaskId: string;
	installationId: string;
	count: 1;
	expiresAt: number;
}
export type LaunchState =
	| "granted"
	| "dispatching"
	| "awaiting_registration"
	| "awaiting_document"
	| "awaiting_user"
	| "completed"
	| "failed"
	| "uncertain"
	| "cancelled";
export interface LaunchRecord {
	request: LaunchRequest;
	grant: LaunchGrant;
	state: LaunchState;
	ticketId: string;
	nonceHash: string;
	expiresAt: number;
	dispatchAttempted?: boolean;
	before: ProcessIdentity[];
	process?: ProcessIdentity;
	lifecycleInstanceId?: string;
	binding?: TargetBinding;
	detail?: string;
	spawnCandidate?: { pid: number; startIdentity?: string };
}
export interface LaunchStore {
	get(requestId: string): LaunchRecord | undefined;
	all(): LaunchRecord[];
	put(record: LaunchRecord): void;
	observeCandidate(
		requestId: string,
		candidate: { pid: number; startIdentity?: string },
	): void;
	allowsWork(rootTaskId: string): boolean;
	recovered(requestId: string): boolean;
}
/** Launch intent and transitions share the task journal's durable SQLite commits. */
export class JournalLaunchStore implements LaunchStore {
	constructor(private readonly journal: TaskJournal) {}
	allowsWork(rootTaskId: string): boolean {
		const task = this.journal
			.snapshot({ includeEvents: false })
			.tasks.find((row) => row.id === rootTaskId);
		return (
			!!task &&
			task.parent_task_id === null &&
			task.cancellation_requested === 0 &&
			![
				"cancelled",
				"completed",
				"failed",
				"interrupted",
				"uncertain",
			].includes(String(task.state))
		);
	}
	recovered(requestId: string): boolean {
		return this.journal
			.snapshot({ includeEvents: false })
			.records.some(
				(row) =>
					row.kind === "launch_recovery" &&
					row.id === requestId &&
					row.state === "confirmed",
			);
	}
	get(id: string): LaunchRecord | undefined {
		return this.all().find((record) => record.request.requestId === id);
	}
	all(): LaunchRecord[] {
		return this.journal
			.snapshot({ includeEvents: false })
			.records.filter((row) => row.kind === "launch")
			.map((row) => JSON.parse(String(row.payload)) as LaunchRecord);
	}
	observeCandidate(
		requestId: string,
		candidate: { pid: number; startIdentity?: string },
	): void {
		this.journal.recordLaunchCandidate(requestId, candidate);
	}
	put(record: LaunchRecord): void {
		this.journal.persistLaunch(
			JSON.parse(JSON.stringify(record)) as LaunchRecord,
		);
	}
}
export interface LaunchAdapter {
	snapshot(): Promise<ProcessIdentity[]>;
	spawn(
		installationId: string,
		ticketId: string,
		independent: boolean,
	): Promise<
		| ProcessIdentity
		| { spawnCandidate: { pid: number; startIdentity?: string } }
		| undefined
	>;
}
export interface BootstrapTickets {
	create(
		ticketId: string,
		contents: {
			nonce: string;
			requestId: string;
			installationId: string;
			expiresAt: number;
		},
	): void;
}
export class FileBootstrapTickets implements BootstrapTickets {
	constructor(private readonly directory: string) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
	}
	create(
		ticketId: string,
		contents: {
			nonce: string;
			requestId: string;
			installationId: string;
			expiresAt: number;
		},
	): void {
		if (!/^[a-f0-9]{64}$/.test(ticketId))
			throw new Error("Invalid bootstrap ticket reference");
		const fd = openSync(join(this.directory, `${ticketId}.json`), "wx", 0o600);
		try {
			writeFileSync(fd, JSON.stringify(contents));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		if (process.platform !== "win32") {
			const directoryFd = openSync(this.directory, "r");
			try {
				fsyncSync(directoryFd);
			} finally {
				closeSync(directoryFd);
			}
		}
	}
}
export class RhinoLaunchService {
	private readonly activeDispatches = new Set<string>();
	isDispatching(requestId: string): boolean {
		return this.activeDispatches.has(requestId);
	}
	constructor(
		private readonly store: LaunchStore,
		private readonly adapter: LaunchAdapter,
		private readonly tickets: BootstrapTickets,
		private readonly desiredIntent: () => {
			desiredState: "running" | "stopped";
			revision: number;
		},
		private readonly now = Date.now,
	) {}
	grant(request: LaunchRequest, grant: LaunchGrant): LaunchRecord {
		const existing = this.store.get(request.requestId);
		if (existing) {
			if (
				stable(existing.request) !== stable(request) ||
				stable(existing.grant) !== stable(grant)
			)
				throw new Error("Launch request conflict");
			return existing;
		}
		if (
			!request.requestId ||
			!request.rootTaskId ||
			!grant.grantId ||
			grant.count !== 1 ||
			grant.rootTaskId !== request.rootTaskId ||
			grant.installationId !== request.installationId ||
			grant.expiresAt <= this.now()
		)
			throw new Error("Invalid launch grant");
		this.checkIntent(request);
		if (
			this.store.all().some((record) => record.grant.grantId === grant.grantId)
		)
			throw new Error("Launch grant already consumed");
		if (
			!request.independentProcess &&
			this.store
				.all()
				.filter((record) => !this.store.recovered(record.request.requestId))
				.some(
					(record) =>
						!["completed", "failed", "cancelled"].includes(record.state) ||
						(record.state === "cancelled" &&
							record.dispatchAttempted &&
							!record.process),
				)
		)
			throw new Error(
				"Reconcile the existing first-process launch before granting another Rhino launch",
			);
		if (
			this.store
				.all()
				.filter((record) => !this.store.recovered(record.request.requestId))
				.some(
					(record) =>
						["dispatching", "uncertain"].includes(record.state) ||
						(record.state === "cancelled" &&
							record.dispatchAttempted &&
							!record.process),
				)
		)
			throw new Error(
				"Reconcile pending launch before granting another process",
			);
		const nonce = randomBytes(32).toString("hex");
		const ticketId = randomBytes(32).toString("hex");
		const record: LaunchRecord = {
			request: structuredClone(request),
			grant: structuredClone(grant),
			state: "granted",
			ticketId,
			nonceHash: hash(nonce),
			expiresAt: grant.expiresAt,
			before: [],
		};
		this.tickets.create(ticketId, {
			nonce,
			requestId: request.requestId,
			installationId: request.installationId,
			expiresAt: record.expiresAt,
		});
		this.store.put(record);
		return record;
	}
	async start(requestId: string): Promise<LaunchRecord> {
		let record = this.required(requestId);
		if (record.state !== "granted") return record; // Never replay potentially dispatched launches.
		this.checkIntent(record.request);
		if (record.expiresAt <= this.now())
			return this.update(record, {
				state: "failed",
				detail: "Launch grant expired",
			});
		const before = await this.adapter.snapshot();
		record = this.required(requestId);
		if (record.state !== "granted") return record;
		this.checkIntent(record.request);
		if (record.expiresAt <= this.now())
			return this.update(record, {
				state: "failed",
				detail: "Launch grant expired during process discovery",
			});
		if (!record.request.independentProcess && before.length > 0)
			return this.update(record, {
				state: "failed",
				detail:
					"Rhino is already running. Attach its existing process; additional Mac targets use New document windows",
			});
		record = this.update(record, {
			state: "dispatching",
			dispatchAttempted: true,
			before,
		});
		this.activeDispatches.add(requestId);
		try {
			const spawned = await this.adapter.spawn(
				record.request.installationId,
				record.ticketId,
				record.request.independentProcess,
			);
			const process = spawned && "pid" in spawned ? spawned : undefined;
			const candidate =
				spawned && "spawnCandidate" in spawned
					? spawned.spawnCandidate
					: undefined;
			if (candidate ?? process)
				this.store.observeCandidate(requestId, (candidate ?? process)!);
			const latest = this.required(requestId);
			if (latest.state !== "dispatching") return latest;
			if (process && before.some((candidate) => candidate.pid === process.pid))
				return this.update(latest, {
					state: "uncertain",
					detail: "Launcher returned a pre-existing process",
				});
			return this.update(latest, {
				state: "awaiting_registration",
				process,
				...(candidate ? { spawnCandidate: candidate } : {}),
			});
		} catch (error) {
			const latest = this.required(requestId);
			if (latest.state !== "dispatching") return latest;
			return this.update(latest, {
				state: error instanceof LaunchNotStartedError ? "failed" : "uncertain",
				detail:
					error instanceof Error
						? error.message
						: "Launch failed without process evidence",
			});
		} finally {
			this.activeDispatches.delete(requestId);
		}
	}
	register(input: {
		requestId: string;
		ticketId: string;
		nonce: string;
		installationId: string;
		process: ProcessIdentity;
		lifecycleInstanceId: string;
		compatible: boolean;
	}): LaunchRecord {
		const record = this.required(input.requestId);
		this.checkIntent(record.request);
		if (["cancelled", "failed", "granted"].includes(record.state))
			throw new Error("Bootstrap ticket is no longer usable");
		if (
			!input.compatible ||
			!input.lifecycleInstanceId ||
			input.ticketId !== record.ticketId ||
			input.installationId !== record.request.installationId ||
			!timingSafeEqual(
				Buffer.from(hash(input.nonce)),
				Buffer.from(record.nonceHash),
			)
		)
			throw new Error("Bootstrap authentication failed");
		if (
			!Number.isSafeInteger(input.process.pid) ||
			input.process.pid <= 0 ||
			!input.process.startIdentity ||
			record.before.some((process) => process.pid === input.process.pid) ||
			(record.process && !sameProcess(record.process, input.process))
		)
			throw new Error("Bootstrap process correlation failed");
		// A committed registration response may be lost. An exact authenticated retry
		// acknowledges the original registration without spending the ticket again.
		if (record.lifecycleInstanceId) {
			if (
				record.lifecycleInstanceId !== input.lifecycleInstanceId ||
				!record.process ||
				!sameProcess(record.process, input.process)
			)
				throw new Error("Bootstrap lifecycle correlation failed");
			return record;
		}
		if (record.expiresAt <= this.now())
			throw new Error("Bootstrap authentication failed");
		return this.update(record, {
			state: "awaiting_document",
			process: input.process,
			lifecycleInstanceId: input.lifecycleInstanceId,
		});
	}
	documentReady(requestId: string, binding: TargetBinding): LaunchRecord {
		const record = this.required(requestId);
		this.checkIntent(record.request);
		if (!validateTargetBinding(binding).ok)
			throw new Error("Invalid launch document binding");
		if (
			!["awaiting_document", "uncertain", "awaiting_user"].includes(
				record.state,
			) ||
			!record.lifecycleInstanceId ||
			!record.process ||
			binding.lifecycleInstanceId !== record.lifecycleInstanceId ||
			binding.kind !== "rhino"
		)
			throw new Error("Launch document does not match its grant");
		return this.update(record, {
			state: "completed",
			binding: structuredClone(binding),
		});
	}
	cancel(requestId: string): LaunchRecord {
		const record = this.required(requestId);
		return ["completed", "failed", "cancelled"].includes(record.state)
			? record
			: this.update(record, { state: "cancelled" });
	}
	timeout(requestId: string, observedDialog?: string): LaunchRecord {
		const record = this.required(requestId);
		if (["completed", "failed", "cancelled"].includes(record.state))
			return record;
		return this.update(record, {
			state: observedDialog ? "awaiting_user" : "uncertain",
			detail:
				observedDialog ??
				"Startup outcome unknown; reconcile before another spawn",
		});
	}
	private checkIntent(request: LaunchRequest): void {
		if (!this.store.allowsWork(request.rootTaskId))
			throw new Error("Launch task is no longer authorized");
		const intent = this.desiredIntent();
		if (
			intent.desiredState !== "running" ||
			intent.revision !== request.intentRevision
		)
			throw new Error("Launch rejected by current host intent");
	}
	private required(id: string): LaunchRecord {
		const value = this.store.get(id);
		if (!value) throw new Error("Unknown launch request");
		return value;
	}
	private update(
		record: LaunchRecord,
		patch: Partial<LaunchRecord>,
	): LaunchRecord {
		const next = { ...record, ...patch };
		this.store.put(next);
		return next;
	}
}
function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
function sameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
	return a.pid === b.pid && a.startIdentity === b.startIdentity;
}

export class LaunchNotStartedError extends Error {}

export interface VerifiedInstallation {
	id: string;
	executable: string;
	platform: "win32" | "darwin";
	/** Set only after a packaged native probe establishes this exact installation's bootstrap mechanism. */
	bootstrapVerified: boolean;
	independentProcessVerified: boolean;
	bootstrapArguments(ticketId: string): string[];
}
/** Structured executable/argument launch. Native capability evidence is deliberately explicit. */
export class NativeRhinoLaunchAdapter implements LaunchAdapter {
	constructor(
		private readonly installations: readonly VerifiedInstallation[],
		private readonly processSnapshot: () => Promise<ProcessIdentity[]>,
	) {}
	snapshot(): Promise<ProcessIdentity[]> {
		return this.processSnapshot();
	}
	async spawn(
		installationId: string,
		ticketId: string,
		independent: boolean,
	): Promise<{ spawnCandidate: { pid: number; startIdentity?: string } }> {
		const installation = this.installations.find(
			(item) => item.id === installationId,
		);
		if (
			!installation ||
			!installation.bootstrapVerified ||
			(independent && !installation.independentProcessVerified)
		)
			throw new LaunchNotStartedError(
				"Required Rhino launch/bootstrap capability has not passed a packaged platform probe",
			);
		if (!/^[a-f0-9]{64}$/.test(ticketId))
			throw new Error("Invalid bootstrap ticket reference");
		const candidatePid = await new Promise<number>((resolve, reject) => {
			const child = spawn(
				installation.executable,
				installation.bootstrapArguments(ticketId),
				{ detached: true, stdio: "ignore", shell: false, windowsHide: false },
			);
			child.once("error", (error) =>
				reject(new LaunchNotStartedError(error.message)),
			);
			child.once("spawn", () => {
				child.unref();
				resolve(child.pid!);
			});
		});
		// The launcher PID can be a helper process. Only authenticated native registration establishes identity.
		let candidate: ProcessIdentity | undefined;
		try {
			candidate = (await this.processSnapshot()).find(
				(item) => item.pid === candidatePid,
			);
		} catch {
			/* Retain the direct spawn PID even if OS identity observation fails. */
		}
		return {
			spawnCandidate: {
				pid: candidatePid,
				...(candidate ? { startIdentity: candidate.startIdentity } : {}),
			},
		};
	}
}

function stable(value: object): string {
	return JSON.stringify(value, Object.keys(value).sort());
}

/** Rhino 8.34 on macOS: direct executable launch produced a distinct process; open -na did not. */
export function macRhinoInstallation(options: {
	id: string;
	applicationPath: string;
	independentProcessVerified?: boolean;
	bootstrapVerified?: boolean;
	bootstrapArguments: (ticketId: string) => string[];
}): VerifiedInstallation {
	return {
		id: options.id,
		executable: join(
			options.applicationPath,
			"Contents",
			"MacOS",
			"Rhinoceros",
		),
		platform: "darwin",
		independentProcessVerified: options.independentProcessVerified ?? false,
		bootstrapVerified: options.bootstrapVerified ?? false,
		bootstrapArguments: options.bootstrapArguments,
	};
}
