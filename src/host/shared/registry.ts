import { randomUUID } from "node:crypto";
import type {
	ExecutionOwner,
	TargetBinding,
} from "../../protocol/shared-execution.js";
import { validateTargetBinding } from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";

export type ConversationSession = { id: string; afterConversationSequence: number };

export interface SharedAttachment {
	lifecycleInstanceId: string;
	processId: number;
	processStartTime: string;
	hostEpoch: string;
	attachmentGeneration: string;
	capabilities: readonly string[];
	documents: readonly TargetBinding[];
	documentLabels?: Record<string, string>;
	admission: "recovering" | "ready" | "detached";
	label: string;
	conversationSession?: ConversationSession;
}
const key = (attachment: SharedAttachment) =>
	`${attachment.processId}:${attachment.processStartTime}`;
const equal = (a: TargetBinding, b: TargetBinding) =>
	a.lifecycleInstanceId === b.lifecycleInstanceId &&
	a.kind === b.kind &&
	(a.kind === "rhino"
		? a.rhinoDocumentId === (b as typeof a).rhinoDocumentId
		: a.grasshopperDocumentId === (b as typeof a).grasshopperDocumentId &&
			a.associatedRhinoDocumentId ===
				(b as typeof a).associatedRhinoDocumentId);
export class TargetUnavailableError extends Error {
	constructor(
		message: string,
		readonly permanent: boolean,
	) {
		super(message);
	}
}

/** Authentication and native idle/scope reconciliation precede markReady. */
export class SharedRegistry {
	private readonly attachments = new Map<string, SharedAttachment>();
	private readonly hostSession: ConversationSession;
	constructor(private readonly journal: TaskJournal) {
		// Durable tasks survive a restart for recovery and export. Chat selection
		// starts after those conversations, even when the same Rhino reconnects.
		this.hostSession = { id: randomUUID(), afterConversationSequence: journal.lastConversationSequence };
		for (const row of journal.getAttachments()) {
			const attachment = JSON.parse(String(row.payload)) as SharedAttachment;
			this.attachments.set(attachment.lifecycleInstanceId, {
				...attachment,
				conversationSession: this.hostSession,
				admission: "recovering",
			});
		}
	}
	get conversationSession(): ConversationSession {
		let current = this.hostSession;
		for (const attachment of this.attachments.values()) {
			const session = attachment.conversationSession;
			if (session && session.afterConversationSequence >= current.afterConversationSequence) current = session;
		}
		return { ...current };
	}
	register(attachment: SharedAttachment): void {
		if (
			!Number.isSafeInteger(attachment.processId) ||
			attachment.processId <= 0 ||
			!attachment.processStartTime ||
			!attachment.attachmentGeneration ||
			!attachment.hostEpoch
		)
			throw new Error("Invalid process attachment identity");
		for (const binding of attachment.documents)
			if (
				!validateTargetBinding(binding).ok ||
				binding.lifecycleInstanceId !== attachment.lifecycleInstanceId
			)
				throw new Error("Invalid attachment document");
		const prior = this.attachments.get(attachment.lifecycleInstanceId);
		if (prior && key(prior) !== key(attachment))
			throw new Error("Lifecycle process identity changed");
		for (const other of this.attachments.values())
			if (
				other.lifecycleInstanceId !== attachment.lifecycleInstanceId &&
				key(other) === key(attachment) &&
				other.admission !== "detached"
			)
				throw new Error("Process already has an attached lifecycle");
		this.save({ ...structuredClone(attachment), conversationSession: attachment.conversationSession ?? this.conversationSession, admission: "recovering" });
	}
	markReady(
		lifecycleId: string,
		evidence: {
			authenticated: boolean;
			generation: string;
			operationsIdle: boolean;
			rhinoScopeIdle: boolean;
			grasshopperScopeIdle: boolean;
		},
	): void {
		const attachment = this.get(lifecycleId);
		if (
			!evidence.authenticated ||
			evidence.generation !== attachment.attachmentGeneration ||
			!evidence.operationsIdle ||
			!evidence.rhinoScopeIdle ||
			!evidence.grasshopperScopeIdle
		)
			throw new Error("Attachment cleanup is unconfirmed");
		this.save({ ...attachment, admission: "ready" });
	}
	updateDocuments(
		lifecycleId: string,
		documents: readonly TargetBinding[],
		documentLabels?: Record<string, string>,
	): void {
		const attachment = this.get(lifecycleId);
		for (const binding of documents)
			if (
				!validateTargetBinding(binding).ok ||
				binding.lifecycleInstanceId !== lifecycleId
			)
				throw new Error("Invalid attachment document");
		this.save({
			...attachment,
			documents: structuredClone(documents),
			...(documentLabels
				? { documentLabels: structuredClone(documentLabels) }
				: {}),
		});
	}
	detach(lifecycleId: string): void {
		this.save({ ...this.get(lifecycleId), admission: "detached" });
	}
	list(): SharedAttachment[] {
		return structuredClone([...this.attachments.values()]);
	}
	accessibleTargets(bindings: readonly TargetBinding[]): SharedAttachment[] {
		return this.list()
			.filter((target) => target.admission === "ready")
			.map((target) => ({
				...target,
				documents: target.documents.filter((document) =>
					bindings.some((binding) => equal(binding, document))),
			}))
			.filter((target) => target.documents.length > 0);
	}
	private get(id: string): SharedAttachment {
		const attachment = this.attachments.get(id);
		if (!attachment)
			throw new TargetUnavailableError(
				"Rhino lifecycle is not attached; waiting for registration",
				false,
			);
		return attachment;
	}
	private save(attachment: SharedAttachment): void {
		this.journal.attachment(attachment.lifecycleInstanceId, attachment);
		this.attachments.set(attachment.lifecycleInstanceId, attachment);
	}
	resolveBinding(binding: TargetBinding): {
		processKey: string;
		attachmentGeneration: string;
	} {
		const attachment = this.get(binding.lifecycleInstanceId);
		if (attachment.admission !== "ready")
			throw new TargetUnavailableError(
				"Rhino attachment is " +
					attachment.admission +
					"; waiting for authenticated recovery",
				false,
			);
		if (!attachment.documents.some((document) => equal(document, binding)))
			throw new TargetUnavailableError(
				"Selected document closed or its association changed; submit a fresh target selection",
				true,
			);
		return {
			processKey: key(attachment),
			attachmentGeneration: attachment.attachmentGeneration,
		};
	}
	resolveLifecycle(lifecycleId: string): {
		processKey: string;
		attachmentGeneration: string;
	} {
		const attachment = this.get(lifecycleId);
		if (attachment.admission !== "ready")
			throw new Error("Lifecycle is not ready");
		return {
			processKey: key(attachment),
			attachmentGeneration: attachment.attachmentGeneration,
		};
	}

	validateBinding(owner: ExecutionOwner): void {
		const attachment = this.get(owner.binding.lifecycleInstanceId);
		if (attachment.attachmentGeneration !== owner.attachmentGeneration)
			throw new Error("Stale attachment generation");
		if (attachment.admission === "detached")
			throw new TargetUnavailableError(
				"Rhino attachment is detached; waiting for authenticated recovery",
				false,
			);
		if (
			!attachment.documents.some((document) => equal(document, owner.binding))
		)
			throw new TargetUnavailableError(
				"Selected document closed or its association changed; submit a fresh target selection",
				true,
			);
		// Inventory can time out while this issued owner holds a native scope.
		// Recovering blocks new admission without retargeting the existing owner.
	}
}
