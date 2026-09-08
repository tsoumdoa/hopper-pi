import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { TaskJournal } from "./journal.js";

export interface ControlState {
	version: 1;
	revision: number;
	desiredState: "running" | "stopped";
	endpointPort: number;
	dataDirectory: string;
	journalIdentity: string;
	browserCredential: string;
}
export interface HostDiscovery {
	hostEpoch: string;
	pid: number;
	processStartIdentity: string;
	protocolVersion: number;
	schemaVersion: number;
	registrationToken: string;
	endpointPort: number;
	dataDirectory: string;
	journalIdentity: string;
	revision: number;
}
export function defaultControlDirectory(): string {
	return join(userInfo().homedir, ".hopper", "shared-control");
}

/** Control location is independent of --data-dir. The optional path/port are for isolated tests. */
export class SharedHostControl {
	readonly directory: string;
	private readonly lockPort: number;
	constructor(directory = defaultControlDirectory(), lockPort?: number) {
		this.directory = resolve(directory);
		this.lockPort =
			lockPort ??
			35000 +
				(createHash("sha256").update(this.directory).digest().readUInt32BE(0) %
					10000);
	}
	private protect(path: string, directory: boolean): void {
		if (process.platform === "win32") {
			// chmod does not restrict Windows ACLs. Fail closed when an ACL cannot be installed.
			execFileSync(
				"icacls.exe",
				[
					path,
					"/inheritance:r",
					"/grant:r",
					`${userInfo().username}:${directory ? "(OI)(CI)" : ""}F`,
				],
				{ stdio: "pipe" },
			);
		} else chmodSync(path, directory ? 0o700 : 0o600);
	}
	private write(name: string, value: unknown): void {
		const temporary = join(this.directory, `.${name}.${randomUUID()}`);
		const fd = openSync(temporary, "wx", 0o600);
		try {
			writeFileSync(fd, JSON.stringify(value));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		this.protect(temporary, false);
		renameSync(temporary, join(this.directory, name));
		if (process.platform !== "win32") {
			const directoryFd = openSync(this.directory, "r");
			try {
				fsyncSync(directoryFd);
			} finally {
				closeSync(directoryFd);
			}
		}
	}
	private read(): ControlState | null {
		const file = join(this.directory, "control.json");
		if (!existsSync(file)) return null;
		let value: ControlState;
		try {
			value = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			throw new Error(
				"Shared host control is corrupt; explicit offline recovery is required",
			);
		}
		if (
			value.version !== 1 ||
			!Number.isSafeInteger(value.revision) ||
			value.revision < 1 ||
			!["running", "stopped"].includes(value.desiredState) ||
			!Number.isInteger(value.endpointPort) ||
			value.endpointPort < 1 ||
			value.endpointPort > 65535 ||
			typeof value.dataDirectory !== "string" ||
			!value.dataDirectory ||
			typeof value.journalIdentity !== "string" ||
			!value.journalIdentity ||
			typeof value.browserCredential !== "string" ||
			!/^[a-f0-9]{64}$/.test(value.browserCredential)
		)
			throw new Error(
				"Invalid shared control record; explicit offline recovery is required",
			);
		return value;
	}
	async locked<T>(action: () => Promise<T> | T): Promise<T> {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		this.protect(this.directory, true);
		const server = createServer((socket) => socket.destroy());
		const deadline = Date.now() + 5000;
		while (true) {
			try {
				await listen(server, this.lockPort);
				break;
			} catch (error) {
				if (
					(error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
					Date.now() >= deadline
				)
					throw new Error(
						"Shared control lock is busy; retry or inspect the owning process",
						{ cause: error },
					);
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		}
		try {
			return await action();
		} finally {
			await close(server);
		}
	}
	async initialize(options: {
		defaultDataDirectory: string;
		dataDirectory?: string;
		explicitStart?: boolean;
	}): Promise<ControlState> {
		return this.locked(async () => {
			let state = this.read();
			if (state) {
				if (!existsSync(state.dataDirectory))
					throw new Error(
						`Pinned shared storage is missing: ${state.dataDirectory}`,
					);
				if (
					realpathSync(state.dataDirectory) !== state.dataDirectory ||
					!statSync(state.dataDirectory).isDirectory()
				)
					throw new Error("Pinned shared storage identity changed");
				if (
					options.dataDirectory &&
					realpathSync(options.dataDirectory) !== state.dataDirectory
				)
					throw new Error(
						`Shared storage conflict; pinned directory is ${state.dataDirectory}`,
					);
				if (!existsSync(join(state.dataDirectory, "journal.sqlite")))
					throw new Error(
						"Pinned journal is missing; refusing to create empty history",
					);
				if (
					readJournalIdentity(join(state.dataDirectory, "journal.sqlite")) !==
					state.journalIdentity
				)
					throw new Error("Pinned journal identity mismatch");
				if (options.explicitStart && state.desiredState === "stopped") {
					state = {
						...state,
						desiredState: "running",
						revision: state.revision + 1,
					};
					this.write("control.json", state);
				}
				return state;
			}
			const requested = resolve(
				options.dataDirectory ?? options.defaultDataDirectory,
			);
			mkdirSync(requested, { recursive: true, mode: 0o700 });
			const dataDirectory = realpathSync(requested);
			this.protect(dataDirectory, true);
			const journal = new TaskJournal(join(dataDirectory, "journal.sqlite"));
			let journalIdentity: string;
			try {
				journalIdentity = journal.identity;
			} finally {
				journal.close();
			}
			this.protect(join(dataDirectory, "journal.sqlite"), false);
			const probe = createServer();
			await listen(probe, 0);
			const endpointPort = (probe.address() as { port: number }).port;
			await close(probe);
			state = {
				version: 1,
				revision: 1,
				desiredState: "running",
				endpointPort,
				dataDirectory,
				journalIdentity,
				browserCredential: randomBytes(32).toString("hex"),
			};
			this.write("control.json", state);
			return state;
		});
	}
	async setDesiredState(
		desiredState: "running" | "stopped",
		expectedRevision: number,
	): Promise<ControlState> {
		return this.locked(() => {
			const state = this.read();
			if (!state || state.revision !== expectedRevision)
				throw new Error("Stale shared host intent revision");
			const next = { ...state, desiredState, revision: state.revision + 1 };
			this.write("control.json", next);
			return next;
		});
	}
	readDiscovery(): HostDiscovery | null {
		const path = join(this.directory, "discovery.json");
		if (!existsSync(path)) return null;
		try {
			return JSON.parse(readFileSync(path, "utf8")) as HostDiscovery;
		} catch {
			throw new Error(
				"Shared host discovery is corrupt; inspect the control directory",
			);
		}
	}
	async snapshot(): Promise<ControlState | null> {
		return this.locked(() => this.read());
	}
	async acquireOwnership(
		server: Server,
		expectedRevision: number,
	): Promise<ControlState> {
		return this.locked(async () => {
			const state = this.read();
			if (
				!state ||
				state.desiredState !== "running" ||
				state.revision !== expectedRevision
			)
				throw new Error("Shared startup intent changed");
			try {
				await listen(server, state.endpointPort);
			} catch (error) {
				throw new Error(
					`Shared endpoint ${state.endpointPort} is occupied; do not start a fallback host`,
					{ cause: error },
				);
			}
			return state;
		});
	}
	async publish(discovery: HostDiscovery): Promise<void> {
		return this.locked(() => {
			const state = this.read();
			if (
				!state ||
				state.desiredState !== "running" ||
				discovery.revision !== state.revision ||
				discovery.endpointPort !== state.endpointPort ||
				discovery.dataDirectory !== state.dataDirectory ||
				discovery.journalIdentity !== state.journalIdentity
			)
				throw new Error(
					"Discovery does not match current shared host intent/storage",
				);
			this.write("discovery.json", discovery);
		});
	}
}
function listen(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const error = (error: Error) => {
			server.off("listening", ready);
			reject(error);
		};
		const ready = () => {
			server.off("error", error);
			resolve();
		};
		server.once("error", error);
		server.once("listening", ready);
		server.listen({ host: "127.0.0.1", port, exclusive: true });
	});
}
function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

function readJournalIdentity(path: string): string {
	const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
		DatabaseSync: new (
			path: string,
			options: { readOnly: boolean },
		) => {
			prepare(sql: string): { get(): { id: string } | undefined };
			close(): void;
		};
	};
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const row = database.prepare("SELECT id FROM identity").get();
		if (!row || typeof row.id !== "string")
			throw new Error("Pinned journal identity is missing");
		return row.id;
	} finally {
		database.close();
	}
}
