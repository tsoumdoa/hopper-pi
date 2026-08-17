import { readFile, readdir, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { RequestId, SessionId } from "../core/contracts.js";
import type { BackendIdentity, BackendDocuments } from "../protocol/wire.js";
import type { ExecuteActionsRequest, RestoreCheckpointRequest } from "../protocol/wire.js";
import {
	ensureSessionLayout,
	journalPath,
	newSessionId,
	requestsDirectory,
	sessionDirectory,
	sessionFilePath,
	writeFileAtomic,
} from "./paths.js";

export type SessionBinding = {
	backendId: BackendIdentity["backendId"];
	grasshopperDocumentId: NonNullable<BackendDocuments["grasshopper"]>["documentId"];
	grasshopperDocumentPath: string | null;
	rhinoDocumentId: BackendDocuments["rhino"] extends null ? null : string | null;
	rhinoDocumentPath: string | null;
	boundAt: string;
};

export type SessionRecord = {
	schemaVersion: 1;
	sessionId: SessionId;
	name: string | null;
	createdAt: string;
	closedAt: string | null;
	binding: SessionBinding;
	captureAllowed: boolean;
	nextEditSequence: number;
	cliVersion: string;
	pluginVersion: string;
	protocolVersion: 1;
};

export type StoredRequest = {
	schemaVersion: 1;
	requestId: RequestId;
	payloadSha256: string;
	request: ExecuteActionsRequest | RestoreCheckpointRequest;
};

export class SessionStoreError extends Error {
	constructor(message: string, readonly code: "session_not_found" | "session_closed" | "session_io") {
		super(message);
		this.name = "SessionStoreError";
	}
}

function bindingFrom(backend: BackendIdentity, documents: BackendDocuments, at: string): SessionBinding {
	return {
		backendId: backend.backendId,
		grasshopperDocumentId: documents.grasshopper.documentId,
		grasshopperDocumentPath: documents.grasshopper.path,
		rhinoDocumentId: documents.rhino?.documentId ?? null,
		rhinoDocumentPath: documents.rhino?.path ?? null,
		boundAt: at,
	};
}

export class SessionStore {
	constructor(
		readonly stateRoot: string,
		private readonly cliVersion: string = "0.1.90",
	) {}

	async create(
		options: { name?: string; captureAllowed: boolean },
		backend: BackendIdentity,
		documents: BackendDocuments,
	): Promise<SessionRecord> {
		const sessionId = newSessionId();
		await ensureSessionLayout(this.stateRoot, sessionId);
		const record: SessionRecord = {
			schemaVersion: 1,
			sessionId,
			name: options.name ?? null,
			createdAt: new Date().toISOString(),
			closedAt: null,
			binding: bindingFrom(backend, documents, new Date().toISOString()),
			captureAllowed: options.captureAllowed,
			nextEditSequence: 1,
			cliVersion: this.cliVersion,
			pluginVersion: backend.pluginVersion,
			protocolVersion: 1,
		};
		await this.persist(record);
		return record;
	}

	async read(sessionId: SessionId): Promise<SessionRecord> {
		try {
			const contents = await readFile(sessionFilePath(this.stateRoot, sessionId), "utf8");
			return JSON.parse(contents) as SessionRecord;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new SessionStoreError(`Session ${sessionId} does not exist.`, "session_not_found");
			}
			throw new SessionStoreError(`Session ${sessionId} could not be read.`, "session_io");
		}
	}

	async list(): Promise<SessionRecord[]> {
		const sessionsRoot = join(this.stateRoot, "sessions");
		let entries: string[];
		try {
			entries = await readdir(sessionsRoot);
		} catch {
			return [];
		}
		const records: SessionRecord[] = [];
		for (const entry of entries.sort()) {
			if (!entry.startsWith("hs_")) continue;
			try {
				records.push(await this.read(entry as SessionId));
			} catch {
				// Skip unreadable sessions; listing is read-only.
			}
		}
		return records;
	}

	async update(session: SessionRecord): Promise<void> {
		await this.read(session.sessionId);
		await this.persist(session);
	}

	async close(sessionId: SessionId, closedAt: string): Promise<SessionRecord> {
		const session = await this.read(sessionId);
		if (session.closedAt) return session;
		session.closedAt = closedAt;
		await this.persist(session);
		return session;
	}

	async rebind(
		sessionId: SessionId,
		backend: BackendIdentity,
		documents: BackendDocuments,
	): Promise<{ session: SessionRecord; previous: SessionBinding }> {
		const session = await this.read(sessionId);
		const previous = session.binding;
		session.binding = bindingFrom(backend, documents, new Date().toISOString());
		session.pluginVersion = backend.pluginVersion;
		await this.persist(session);
		return { session, previous };
	}

	async reserveEditId(sessionId: SessionId): Promise<`edit_${string}`> {
		const session = await this.read(sessionId);
		if (session.closedAt) {
			throw new SessionStoreError(`Session ${sessionId} is closed.`, "session_closed");
		}
		const sequence = session.nextEditSequence;
		session.nextEditSequence = sequence + 1;
		await this.persist(session);
		return `edit_${sequence.toString(10).padStart(6, "0")}` as `edit_${string}`;
	}

	async writeRequest(sessionId: SessionId, request: StoredRequest): Promise<void> {
		await ensureSessionLayout(this.stateRoot, sessionId);
		const path = join(
			requestsDirectory(this.stateRoot, sessionId),
			`${request.requestId}.json`,
		);
		const temporary = `${path}.tmp-${randomBytes(4).toString("hex")}`;
		const { writeFile } = await import("node:fs/promises");
		await writeFile(temporary, `${JSON.stringify(request, null, "\t")}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		const { flushDirectory } = await import("./paths.js");
		await rename(temporary, path);
		await flushDirectory(join(path, ".."));
	}

	async readRequest(sessionId: SessionId, requestId: RequestId): Promise<StoredRequest> {
		try {
			const contents = await readFile(
				join(requestsDirectory(this.stateRoot, sessionId), `${requestId}.json`),
				"utf8",
			);
			return JSON.parse(contents) as StoredRequest;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new SessionStoreError(
					`Request ${requestId} is not stored for session ${sessionId}.`,
					"session_not_found",
				);
			}
			throw new SessionStoreError(`Request ${requestId} could not be read.`, "session_io");
		}
	}

	async remove(sessionId: SessionId): Promise<void> {
		await rm(sessionDirectory(this.stateRoot, sessionId), { recursive: true, force: true });
	}

	private async persist(session: SessionRecord): Promise<void> {
		await ensureSessionLayout(this.stateRoot, session.sessionId);
		await writeFileAtomic(
			sessionFilePath(this.stateRoot, session.sessionId),
			`${JSON.stringify(session, null, "\t")}\n`,
		);
	}

	journalFile(sessionId: SessionId): string {
		return journalPath(this.stateRoot, sessionId);
	}
}
