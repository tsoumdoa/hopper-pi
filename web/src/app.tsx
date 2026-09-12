import { readOwner, readTaskInput } from "../../src/protocol/browser-payloads.js";
import { readJson, array, nullable, string } from "../../src/protocol/browser-schema.js";
import { readBinding } from "../../src/protocol/browser-snapshot.js";
import { randomId } from "./lib/random-id";
import { MAX_IMAGES } from "../../src/host/protocol";
import { ImageAttachmentContext } from "./components/image-gallery";
import { useSharedConnection } from "./hooks/use-shared-connection";
import { Box, Loader2, Power } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SharedBrowserCommand } from "../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../src/protocol/shared-execution.js";
import { Composer, type ComposerHandle } from "./components/composer";
import { ConfirmDialog, type ConfirmRequest } from "./components/confirm-dialog";
import { ConnectionBanner } from "./components/connection-banner";
import { ModelControls, toolbarTriggerClass } from "./components/model-picker";
import { ProviderDialog } from "./components/provider-dialog";
import { RhinoInstancesPanel, summarizeInstances } from "./components/rhino-instances";
import { ArchivedThreadsDialog } from "./components/archived-threads-dialog";
import { ThreadList } from "./components/thread-list";
import { Sidebar } from "./components/sidebar";
import { SkillsDialog } from "./components/skills-dialog";
import { TaskThread } from "./components/task-thread";
import { ToastRegion } from "./components/toasts";
import { ToolsDialog } from "./components/tools-dialog";
import { UiRequestDialog } from "./components/ui-request-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { draftImagesReducer } from "./state/draft-images";
import { TooltipProvider } from "./components/ui/tooltip";
import { cn, providerLabel } from "./lib/utils";
import { useHopperStore, useHopperStoreApi } from "./state/hopper-store-context";
import type { ConnectionStatus, SendMode } from "./state/hopper-types";
import { bindingLabeler, readyTargets, sameBinding, type TaskSnapshot, type ConversationSnapshot, type SharedSnapshot } from "./state/shared-snapshot";

const CONVERSATION_KEY = "hopper.conversation";
const SIDEBAR_KEY = "hopper.sidebar.collapsed";
const ACTIVE_ROOT_STATES = ["running", "suspending", "awaiting_user"];

function readCollapsed() {
	try {
		return window.localStorage.getItem(SIDEBAR_KEY) === "1";
	} catch {
		return false;
	}
}

function StatusPill({ status, activeRoot }: { status: ConnectionStatus; activeRoot: TaskSnapshot | undefined }) {
	if (status !== "connected") {
		const label = { connecting: "Connecting", authenticating: "Authenticating", disconnected: "Offline", error: "Offline" }[status];
		const lost = status === "disconnected" || status === "error";
		return <Badge className="h-7 gap-2 border-0 bg-transparent p-0 text-xs font-normal" variant={lost ? "neutral" : "warn"} dot pulse={!lost}><span className="text-ink">{label}</span></Badge>;
	}
	if (!activeRoot) return <Badge variant="accent" className="h-7 gap-2 border-0 bg-transparent p-0 text-xs font-normal" dot><span className="text-ink">Ready</span></Badge>;
	if (activeRoot.state === "awaiting_user") return <Badge variant="warn" className="h-7 gap-2 border-0 bg-transparent p-0 text-xs font-normal" dot><span className="text-ink">Answer needed</span></Badge>;
	return <Badge variant="accent" dot pulse className="h-7 gap-2 border-0 bg-transparent p-0 text-xs font-normal">
		<span className="text-ink">{activeRoot.state === "suspending" ? "Stopping" : "Working"}</span>
	</Badge>;
}

export function App() {
	const store = useHopperStoreApi();
	const connection = useHopperStore((state) => state.connection);
	const connected = connection.status === "connected";

	const [providerOpen, setProviderOpen] = useState(false);
	const [providerView, setProviderView] = useState<"overview" | "catalog">("overview");
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
	const [archiveManagerOpen, setArchiveManagerOpen] = useState(false);
	const [archiveUndo, setArchiveUndo] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

	const [snapshot, setSnapshot] = useState<SharedSnapshot>();
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;
	const [conversationId, setConversationId] = useState("");
	const [recoveryReturnConversation, setRecoveryReturnConversation] = useState("");
	const [selected, setSelected] = useState<TargetBinding[]>([]);
	const selectionExplicit = useRef(false);
	const initialInstance = useRef(new URLSearchParams(window.location.search).get("instance"));
	const initialDocument = useRef(new URLSearchParams(window.location.search).get("document"));
	const conversationStorageKey = useRef(initialInstance.current ? `${CONVERSATION_KEY}:${initialInstance.current}` : CONVERSATION_KEY);
	const [onlyThisInstance, setOnlyThisInstance] = useState(false);
	const selectTargets = (bindings: TargetBinding[]) => { selectionExplicit.current = true; setSelected(bindings); };
	const [draft, setDraft] = useState("");
	const [{ images, error: attachmentError }, setImages] = useReducer(draftImagesReducer, { images: [] });
	// Explicit delivery choice made while a task runs; null means the default for the current state.
	const [modeOverride, setModeOverride] = useState<SendMode | null>(null);
	const composer = useRef<ComposerHandle>(null);
	const focusedComposer = useRef<string | undefined>(undefined);
	const [atChatBottom, setAtChatBottom] = useState(true);
	const historyBefore = useRef<number | undefined>(undefined);
	const currentConversation = useRef(conversationId);
	currentConversation.current = conversationId;
	const draftRef = useRef({ text: draft, images, selected, onlyThisInstance });
	draftRef.current = { text: draft, images, selected, onlyThisInstance };
	const drafts = useRef(new Map<string, typeof draftRef.current>());
	const selectConversation = (id: string) => {
		if (id !== currentConversation.current) {
			drafts.current.set(currentConversation.current, draftRef.current);
			const saved = drafts.current.get(id);
			setDraft(saved?.text ?? ""); setImages(saved?.images ?? []);
			const row = snapshotRef.current?.conversations.find(row => row.id === id);
			const target = readJson(row?.last_message_target === undefined ? row?.document_target : row.last_message_target, nullable(readBinding), null);
			selectionExplicit.current = true;
			setSelected(saved?.selected ?? (target ? [target] : []));
			setOnlyThisInstance(saved?.onlyThisInstance ?? false);
			setModeOverride(null);
		}
		historyBefore.current = undefined;
		currentConversation.current = id;
		setConversationId(id);
		try { window.localStorage.setItem(conversationStorageKey.current, id); } catch { /* Restore from the journal if storage is unavailable. */ }
	};

	const startupRequested = useRef(false);
	const awaitingInitialRegistration = useRef(new URLSearchParams(window.location.search).get("starting") === "1");

	const toast = useCallback((message: string, level: "error" | "warning" | "info" = "error") => store.getState().actions.toast(message, level), [store]);

	useEffect(() => {
		try {
			window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
		} catch {
			// Storage may be unavailable; the preference is only a convenience.
		}
	}, [sidebarCollapsed]);

	const { send, reconnect, blocked, token, pending, isReady } = useSharedConnection({
		store,
		toast,
		getHistoryRequest: () => ({ type: "snapshot", conversationId: currentConversation.current || undefined, before: historyBefore.current }),
		onSnapshot: (next, { wasReady, sessionChanged, enqueue }) => {
			snapshotRef.current = next;
			// An early browser can connect before its Rhino registers. Do not
			// restore a previous session or create a chat until that registration arrives.
			if (awaitingInitialRegistration.current && initialInstance.current &&
				!next.targets.some((target) => target.lifecycleInstanceId === initialInstance.current && target.admission !== "detached")) {
				store.getState().actions.setConnection("authenticating", "Waiting for Rhino to connect…");
				return false;
			}
			if (awaitingInitialRegistration.current) {
				awaitingInitialRegistration.current = false;
				const url = new URL(window.location.href);
				url.searchParams.delete("starting");
				window.history.replaceState(window.history.state, "", url);
			}
			if (wasReady && currentConversation.current && !next.conversations.some(row => row.id === currentConversation.current)) {
				selectConversation(String(next.conversations.find(row => !row.archived_at)?.id ?? ""));
			}
			setSnapshot(next);
			if (sessionChanged) {
				setConversationId("");
				setRecoveryReturnConversation("");
				currentConversation.current = "";
				setDraft("");
				setImages([]);
				setSelected([]);
				selectionExplicit.current = false;
				initialInstance.current = null;
				initialDocument.current = null;
			}
			if (!wasReady || sessionChanged) {
				// Restore within this host session. Host restart or all Rhino processes exiting starts fresh.
				if (!startupRequested.current || sessionChanged) {
					startupRequested.current = true;
					let saved: string | null = null;
					try { saved = window.localStorage.getItem(conversationStorageKey.current); } catch { /* Use the journal fallback below. */ }
					const afterSequence = next.conversationSession?.afterConversationSequence ?? 0;
					const conversations = next.conversations.filter((conversation) =>
						!conversation.archived_at && Number(conversation.sequence ?? 1) > afterSequence && next.sessions.some((session) => session.conversation_id === conversation.id) &&
						(!initialInstance.current || conversation.id === saved || readJson(conversation.instance_ids, array(nullable(string)), []).includes(initialInstance.current)));
					const roots = next.tasks.filter((task) => task.parent_task_id === null && conversations.some((conversation) => conversation.id === task.conversation_id)).reverse();
					const recentTask = roots.find((task) => [...ACTIVE_ROOT_STATES, "queued"].includes(String(task.state))) ?? roots[0];
					const previous = conversations.find((conversation) => conversation.id === saved)
						?? conversations.find((conversation) => conversation.id === recentTask?.conversation_id)
						?? conversations[0]
						?? next.conversations.find(conversation => conversation.live_state);
					if (previous) {
						selectConversation(String(previous.id));
						if (!initialInstance.current) {
							const lastTask = roots.find((task) => task.conversation_id === previous.id);
							const input = readTaskInput(lastTask?.payload);
							const target = input.messageTarget ?? input.bindings?.[0];
							if (target) { selectionExplicit.current = true; setSelected([target]); }
						}
					} else {
						const command: SharedBrowserCommand = { type: "create_conversation", requestId: randomId(), title: "New chat" };
						enqueue(command);
					}
				}
			}
			return true;
		},
		onAccepted: (accepted, message) => {
			if ((accepted?.type === "submit" || accepted?.type === "steer") && accepted.conversationId !== currentConversation.current) {
				const saved = drafts.current.get(accepted.conversationId);
				if (saved) drafts.current.set(accepted.conversationId, { ...saved, text: saved.text === accepted.text ? "" : saved.text, images: saved.images.filter(image => !accepted.attachments.some(attachment => JSON.stringify(attachment) === JSON.stringify(image.image))) });
			}
			if ((accepted?.type === "submit" || accepted?.type === "steer") && accepted.conversationId === currentConversation.current) {
				setDraft((current) => (current === accepted.text ? "" : current));
				setImages((current) => current.filter((image) => !accepted.attachments.some((attachment) => JSON.stringify(attachment) === JSON.stringify(image.image))));
				if (message.result?.admissionError) toast(String(message.result.admissionError), "warning");
			}
			if (accepted?.type === "archive_conversation") setArchiveUndo(accepted.conversationId);
			if (accepted?.type === "unarchive_conversation") setArchiveUndo(null);
			if (accepted?.type === "purge_archived_conversations") {
				for (const id of accepted.conversationIds) drafts.current.delete(id);
				setArchiveManagerOpen(false);
				setArchiveUndo(null);
				toast(`Deleted ${accepted.conversationIds.length} archived threads`, "info");
			}
			if (accepted?.type === "delete_conversation") {
				drafts.current.delete(accepted.conversationId);
				toast("Thread deleted", "info");
			}
			if ((accepted?.type === "delete_conversation" || accepted?.type === "purge_archived_conversations") && message.result?.cleanupPending) {
				toast("Thread history deleted. Some session files could not be removed. Hopper will retry file cleanup on its next start or deletion.", "warning");
			}
			if (accepted?.type === "create_conversation") {
				setRecoveryReturnConversation("");
				if (typeof message.result?.conversationId === "string") selectConversation(message.result.conversationId);
				selectionExplicit.current = false;
				setSelected([]);
				setDraft("");
				setImages([]);
			}
		},
	});

	useEffect(() => {
		if (connected && conversationId) send({ type: "snapshot", conversationId, before: historyBefore.current });
	}, [connected, conversationId]);
	const loadHistory = (before?: number) => {
		if (!isReady()) return;
		historyBefore.current = before;
		send({ type: "snapshot", conversationId, ...(before !== undefined ? { before } : {}) });
	};

	const tasks = snapshot?.tasks.filter((task) => task.conversation_id === conversationId) ?? [];
	const pageTasks = snapshot?.history ? tasks.filter(task => snapshot.history!.pageTaskIds.includes(String(task.id))) : tasks;
	const orderedTasks = pageTasks
		.filter((task) => task.parent_task_id === null)
		.flatMap((root) => [root, ...pageTasks.filter((task) => task.parent_task_id === root.id)]);
	const sessionId = String(snapshot?.sessions.find((session) => session.conversation_id === conversationId && !String(session.id).startsWith("worker-"))?.id ?? "");
	const selectedModel = snapshot?.runtime.models.find((model) => model.provider === snapshot.runtime.model?.provider && model.id === snapshot.runtime.model?.id);
	const imagesSupported = selectedModel?.input?.includes("image") !== false;
	const historyReady = !snapshot?.history || snapshot.history.conversationId === conversationId;
	const submitting = [...pending.values()].some((command) => (command.type === "submit" || command.type === "steer") && command.conversationId === conversationId);
	const activeRoot = tasks.find((task) => task.parent_task_id === null && ACTIVE_ROOT_STATES.includes(String(task.state)));
	const cancellableRoot = activeRoot ?? tasks.find((task) => task.parent_task_id === null && task.state === "queued");
	const selectedConversation = snapshot?.conversations.find(row => row.id === conversationId);
	const liveConversation = snapshot?.conversations.find(row => row.live_state) ?? (cancellableRoot ? selectedConversation : undefined);
	const away = Boolean(liveConversation && liveConversation.id !== conversationId);
	const archived = Boolean(selectedConversation?.archived_at);
	const readOnly = away || archived;
	useEffect(() => {
		if (!archiveUndo) return;
		const timer = setTimeout(() => setArchiveUndo(null), 8000);
		return () => clearTimeout(timer);
	}, [archiveUndo]);
	const taskIsRunning = activeRoot?.state === "running";
	const taskBlocksComposer = activeRoot?.state === "suspending" || activeRoot?.state === "awaiting_user";
	// While a task runs, new text becomes a follow-up unless the user picks otherwise.
	const sendMode: SendMode = modeOverride ?? (taskIsRunning ? "follow_up" : "prompt");
	useEffect(() => {
		if (!taskIsRunning) setModeOverride(null);
	}, [taskIsRunning]);

	const availableTargets = readyTargets(snapshot);
	const documentBindings = availableTargets.flatMap((target) => target.documents);
	const modelBindings = documentBindings.filter((binding) => binding.kind === "rhino");
	useEffect(() => {
		if (!selectionExplicit.current && !selected.length && documentBindings.length) {
			const initial = initialInstance.current
				? modelBindings.find((binding) => binding.lifecycleInstanceId === initialInstance.current &&
					(!initialDocument.current || binding.rhinoDocumentId === initialDocument.current))
				: modelBindings[0] ?? documentBindings[0];
			if (initial) setSelected([initial]);
		}
	}, [snapshot, selected.length]);
	const accessibleBindings = availableTargets
		.filter((target) => !onlyThisInstance || target.lifecycleInstanceId === selected[0]?.lifecycleInstanceId)
		.flatMap((target) => target.documents);
	const labelFor = bindingLabeler(snapshot);
	const activeTurn = snapshot?.turns.find((turn) => turn.task_id === activeRoot?.id && turn.state === "running");
	const activeOwner = readOwner(activeTurn?.owner);
	const activeInput = readTaskInput(activeRoot?.payload);
	const activeBindings = activeOwner?.binding ? [activeOwner.binding] : activeInput.messageTarget ? [activeInput.messageTarget] : activeInput.bindings;
	const toolsContextQuery = new URLSearchParams({
		conversationId,
		...(activeRoot ? { taskId: String(activeRoot.id) } : {}),
		...(selected[0] ? { target: JSON.stringify(selected[0]) } : {}),
	}).toString();
	const steeringDestination = activeBindings.length ? activeBindings.map(labelFor).join(", ") : "Conversation";
	const unavailableSelected = selected.some((binding) => !availableTargets.some((target) => target.documents.some((document) => sameBinding(document, binding))));
	const needsTarget = sendMode !== "steer" && Boolean(
		unavailableSelected || (documentBindings.length > 0 && !selected.length),
	);
	const recoveryInstance = selected[0]?.lifecycleInstanceId ?? initialInstance.current;
	const recoveryChats = snapshot?.conversations.filter(chat => chat.recovery_required && chat.id !== conversationId &&
		recoveryInstance && readyTargets(snapshot).some(target => target.lifecycleInstanceId === recoveryInstance) &&
		readJson(chat.recovery_instance_ids, array(nullable(string)), []).includes(recoveryInstance)) ?? [];
	const title = String(snapshot?.conversations.find((conversation) => conversation.id === conversationId)?.title ?? "New chat");

	useEffect(() => {
		document.title = conversationId ? `${title} · HopperCode` : "HopperCode";
	}, [conversationId, title]);
	// Focus each newly selected chat once, without stealing focus on reconnect.
	useEffect(() => {
		const key = `${conversationId}:${sessionId}`;
		if (connected && sessionId && composer.current && focusedComposer.current !== key) {
			focusedComposer.current = key;
			composer.current.focus();
		}
	}, [connected, conversationId, sessionId]);

	const submit = () => {
		if (!historyReady || readOnly) return;
		if (needsTarget) {
			toast("Choose a connected document first.", "warning");
			return;
		}
		if ((!draft.trim() && !images.length) || !sessionId || (images.length && !imagesSupported)) return;
		const attachments = images.map((image) => image.image);
		const duplicate = [...pending.values()].some(
			(command) => (command.type === "submit" || command.type === "steer") && command.conversationId === conversationId && command.text === draft
				&& JSON.stringify(command.attachments) === JSON.stringify(attachments),
		);
		if (duplicate) return;
		if (sendMode === "steer") {
			const task = tasks.find((task) => task.parent_task_id === null && task.state === "running");
			const turn = snapshot?.turns.find((turn) => turn.task_id === task?.id && turn.state === "running");
			if (!task || !turn) {
				toast("There is no running turn to steer. Send it as a follow-up instead.", "warning");
				return;
			}
			send({ type: "steer", requestId: randomId(), conversationId, sessionId: String(task.session_id), taskId: String(task.id), turnId: String(turn.id), text: draft, attachments });
			return;
		}
		send({ type: "submit", requestId: randomId(), conversationId, sessionId, kind: sendMode, text: draft, bindings: accessibleBindings, ...(selected[0] ? { messageTarget: selected[0] } : {}), attachments });
	};

	const cancelTask = (taskId: string) => send({ type: "cancel", requestId: randomId(), conversationId, taskId });
	const commands = {
		enabled: connected && !readOnly,
		recoveryEnabled: connected && !archived,
		answer: (questionId: string, answer: string | null) => connected && !readOnly && send({ type: "answer", requestId: randomId(), conversationId, questionId, answer }),
		recover: (taskId: string, acknowledgement: string) => connected && !archived && send({ type: "recover", requestId: randomId(), conversationId, taskId, acknowledgement }),
	};

	const manageThread = (row: ConversationSnapshot) => send({ type: row.archived_at ? "unarchive_conversation" : "archive_conversation", requestId: randomId(), conversationId: String(row.id) });
	const deleteThread = (row: ConversationSnapshot) => setConfirm({
		title: `Delete '${row.title}'?`,
		description: "This permanently removes the thread's saved log. Export first if you want a copy.",
		confirmLabel: "Delete thread", destructive: true,
		action: () => send({ type: "delete_conversation", requestId: randomId(), conversationId: String(row.id) }),
	});
	const newChat = () => {
		if (!liveConversation) send({ type: "create_conversation", requestId: randomId(), title: "New chat" });
	};
	const shutdown = () =>
		setConfirm({
			title: "Shut down the Hopper host?",
			description: "This stops the local Hopper host and cancels pending work. Rhino documents stay open, and Rhino can start Hopper again with _HopperCode.",
			confirmLabel: "Shut down",
			destructive: true,
			action: () => {
				if (snapshot) send({ type: "stop_host", requestId: randomId(), hostEpoch: snapshot.hostEpoch });
			},
		});
	const requestLogout = (provider: string) =>
		setConfirm({
			title: `Remove saved credentials for ${providerLabel(provider, store.getState().providers)}?`,
			description: "This removes the credential from the shared Pi store, affecting Pi and other apps that use it. Environment or model configuration credentials may still provide access.",
			confirmLabel: "Remove credentials",
			destructive: true,
			action: () => send({ type: "logout", provider }),
		});
	const openProvider = useCallback(() => {
		setProviderView("overview");
		setMobileSettingsOpen(false);
		setProviderOpen(true);
	}, []);
	const useSuggestion = (text: string) => {
		if (submitting) return;
		setDraft(text);
		composer.current?.focus();
	};

	const destinationLabel = sendMode === "steer" ? `Steering: ${steeringDestination}`
		: selected[0] && !unavailableSelected ? labelFor(selected[0])
		: documentBindings.length ? "Choose a document" : "No documents connected";
	const rhinoPicker = (
		<>
		<Select
			value={selected.length === 1 && !unavailableSelected ? JSON.stringify(selected[0]) : ""}
			onValueChange={(value) => {
				const binding = documentBindings.find((binding) => JSON.stringify(binding) === value);
				if (binding) selectTargets([binding]);
			}}
			disabled={!connected || sendMode === "steer" || !documentBindings.length}
		>
			<SelectTrigger aria-label="Message document" className={cn(toolbarTriggerClass, unavailableSelected && sendMode !== "steer" && "text-danger hover:text-danger")}>
				<Box className="size-3.5 shrink-0" />
				<SelectValue placeholder={<span aria-label="Message destination" className="block truncate">{destinationLabel}</span>}>
					<span aria-label="Message destination" className="block truncate">
						{destinationLabel}
					</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="start" className="max-w-[calc(100vw-2rem)]">
				{documentBindings.map((binding) => (
					<SelectItem key={JSON.stringify(binding)} value={JSON.stringify(binding)}>{labelFor(binding)}</SelectItem>
				))}
			</SelectContent>
		</Select>
		<Button variant="ghost" size="sm" aria-label="Instance access" aria-pressed={onlyThisInstance} title={onlyThisInstance ? "Restrict this message to the chosen document's Rhino process" : "Let this message reach all connected Hopper Code instances"} disabled={!connected || sendMode === "steer" || submitting} onClick={() => setOnlyThisInstance((value) => !value)}>{onlyThisInstance ? "This instance" : "All instances"}</Button>
		</>
	);

	const composerDisabled = !sessionId || !connected || !historyReady || submitting || taskBlocksComposer;
	const attachmentUnavailable = readOnly ? "This chat is read-only"
		: composerDisabled ? "Chat attachments are temporarily unavailable"
		: images.length >= MAX_IMAGES ? `Attach up to ${MAX_IMAGES} images` : undefined;

	return (
		<TooltipProvider><div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink lg:flex-row">
			<a className="skip-link" href="#composer-input">Skip to message</a>
			<Sidebar
				token={token}
				connected={connected}
				collapsed={sidebarCollapsed}
				onCollapsedChange={setSidebarCollapsed}
				mobileOpen={mobileSettingsOpen}
				onMobileOpenChange={setMobileSettingsOpen}
				onNewSession={newChat}
				newThreadDisabled={Boolean(liveConversation)}
				threads={<ThreadList token={token} snapshot={snapshot} connected={connected} selectedId={conversationId} onSelect={id => { selectConversation(id); setMobileSettingsOpen(false); }} onArchive={manageThread} onDelete={deleteThread} onManageArchived={() => { setMobileSettingsOpen(false); setArchiveManagerOpen(true); }} />}
				onManageProvider={openProvider}
				onManageSkills={() => { setMobileSettingsOpen(false); setSkillsOpen(true); }}
				onViewTools={() => { setMobileSettingsOpen(false); setToolsOpen(true); }}
				onReconnect={reconnect}
				rhino={{ summary: summarizeInstances(snapshot, connected), panel: <RhinoInstancesPanel snapshot={snapshot} connected={connected} /> }}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
					<h1 className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight">{title}</h1>
					{recoveryReturnConversation && recoveryReturnConversation !== conversationId && <Button size="sm" variant="ghost" disabled={!connected} onClick={() => {
						selectConversation(recoveryReturnConversation);
						setRecoveryReturnConversation("");
					}}>Back to chat</Button>}
					<div className="-mr-1.5 flex shrink-0 items-center gap-2" role="group" aria-label="Host status and power">
						{away ? <button type="button" onClick={() => selectConversation(String(liveConversation!.id))} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title={`View working thread: ${String(liveConversation!.title)}`}><Badge className="h-7 gap-2 border-0 bg-transparent p-0 text-xs font-normal" variant={liveConversation!.live_state === "awaiting_user" ? "warn" : "accent"} dot pulse><span className="text-ink">{liveConversation!.live_state === "awaiting_user" ? "Answer needed" : "Working"}</span></Badge></button> : <StatusPill status={connection.status} activeRoot={cancellableRoot} />}
						<span aria-hidden="true" className="mx-0.5 h-3 w-px bg-line" />
						<Button size="icon-sm" variant="ghost" className={cn("hover:bg-transparent disabled:opacity-100", connected ? "text-accent hover:text-accent-hover" : "text-muted hover:text-muted")} disabled={!connected || !snapshot} onClick={shutdown} aria-label={connected ? "Shut down the Hopper host" : "Hopper host is offline"} title={connected ? "Shut down the Hopper host" : "Hopper host is offline"}>
							<Power className="size-4" strokeWidth={1.75} />
						</Button>
					</div>
					<ConnectionBanner connection={connection} reconnecting={Boolean(snapshot) && !blocked} onReconnect={reconnect} />
				</header>
				{recoveryChats.slice(0, 1).map(chat => (
					<div key={String(chat.id)} className="flex items-center justify-between gap-3 border-b border-warn/30 bg-warn-soft px-4 py-2 text-sm sm:px-6" role="status">
						<span>An interrupted task needs your review before more work can use this Rhino instance.</span>
						<Button size="sm" variant="secondary" disabled={!connected} onClick={() => {
							setRecoveryReturnConversation(current => current || conversationId);
							selectConversation(String(chat.id));
						}}>Review interrupted task{recoveryChats.length > 1 ? ` (1 of ${recoveryChats.length})` : ""}</Button>
					</div>
				))}
				{!snapshot && (connection.status === "connecting" || connection.status === "authenticating") ? (
					<div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted">
						<Loader2 className="size-5 animate-spin" />
						<p>Starting Hopper…</p>
					</div>
				) : <ImageAttachmentContext.Provider value={{
					attach: attachmentUnavailable ? undefined : (image) => setImages((current) => [...current, image]),
					unavailable: attachmentUnavailable,
				}}><TaskThread
					snapshot={snapshot}
					tasks={orderedTasks}
					connected={connected}
					conversationId={conversationId}
					labelFor={labelFor}
					commands={commands}
					onHistoryPage={loadHistory}
					onBottomChange={setAtChatBottom}
					controlTasks={tasks}
					onSuggestion={useSuggestion}
				/></ImageAttachmentContext.Provider>}
				{readOnly ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel px-6 py-4 text-xs" role="status">
					<span>{away ? `Hopper is working in '${liveConversation!.title}'. This thread is read-only for now.` : "This thread is archived. Unarchive to continue."}</span>
					<Button size="sm" variant="secondary" disabled={!connected} onClick={() => away ? selectConversation(String(liveConversation!.id)) : manageThread(selectedConversation!)}>{away ? "Jump back" : "Unarchive"}</Button>
				</div> : <Composer
					key={conversationId}
					ref={composer}
					atBottom={atChatBottom}
					draft={draft}
					onDraftChange={setDraft}
					images={images}
					onImagesChange={setImages}
					attachmentError={attachmentError}
					imagesSupported={imagesSupported}
					mode={sendMode}
					onModeChange={setModeOverride}
					disabled={composerDisabled}
					placeholder={activeRoot?.state === "awaiting_user" ? "Answer the question above to continue" : activeRoot?.state === "suspending" ? "Finishing the current operation…" : undefined}
					submitDisabled={needsTarget}
					alert={unavailableSelected && sendMode !== "steer" ? "Selected document disconnected. Choose another document." : undefined}
					streaming={taskIsRunning}
					canAbort={Boolean(cancellableRoot)}
					abortDisabled={!connected}
					onSubmit={submit}
					onAbort={() => { if (cancellableRoot) cancelTask(String(cancellableRoot.id)); }}
					controls={
						<>
							<ModelControls
								connected={connected}
								onSelectModel={(value) => {
									const [provider, ...id] = value.split("/");
									if (provider && id.length) send({ type: "set_model", provider, modelId: id.join("/") });
								}}
								onSelectThinking={(level) => send({ type: "set_thinking", level })}
								onManageProvider={() => { setProviderView("catalog"); setProviderOpen(true); }}
							/>
							{rhinoPicker}
						</>
					}
				/>}
			</main>

			{providerOpen && (
				<ProviderDialog
					initialView={providerView}
					onOpenChange={setProviderOpen}
					onLogin={(provider, authType, apiKey) => {
						store.getState().actions.startAuth(provider, "Signing in");
						return send({ type: "login", provider, authType, ...(apiKey ? { apiKey } : {}) });
					}}
					onLogout={requestLogout}
					onAddProvider={config => {
						store.getState().actions.startAuth(config.id, "Saving provider");
						return send({ type: "add_provider", config });
					}}
					onRefresh={provider => {
						store.getState().actions.startAuth(provider, "Checking provider configuration");
						return send({ type: "refresh_providers" });
					}}
					onCancel={() => send({ type: "cancel_auth" })}
					onSelectModel={(provider, modelId) => send({ type: "set_model", provider, modelId })}
					onAuthResponse={(requestId, value) => send({ type: "auth_response", requestId, value })}
				/>
			)}
			{skillsOpen && <SkillsDialog token={token} connected={connected} streaming={Boolean(activeRoot)} onOpenChange={setSkillsOpen} />}
			{toolsOpen && <ToolsDialog key={`${sessionId}:${toolsContextQuery}`} contextQuery={toolsContextQuery} token={token} connected={connected} onOpenChange={setToolsOpen} />}
			<UiRequestDialog suppressAuth={providerOpen} send={(message) => message.type === "ui_response" && send({ type: "auth_response", requestId: message.requestId, value: message.value })} />
			{archiveManagerOpen && <ArchivedThreadsDialog snapshot={snapshot} connected={connected} busy={[...pending.values()].some(command => command.type === "purge_archived_conversations")} onClose={() => setArchiveManagerOpen(false)} onPurge={(conversationIds, before) => send({ type: "purge_archived_conversations", requestId: randomId(), conversationIds, before })} />}
			<ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
			{archiveUndo && <div role="status" className="fixed bottom-4 right-4 z-[60] flex items-center gap-4 rounded-md border border-line bg-surface p-3 text-sm shadow-pop">Thread archived<Button size="xs" variant="ghost" disabled={!connected} onClick={() => send({ type: "unarchive_conversation", requestId: randomId(), conversationId: archiveUndo })}>Undo</Button><button aria-label="Dismiss archive notification" onClick={() => setArchiveUndo(null)}>×</button></div>}
			<ToastRegion />
		</div></TooltipProvider>
	);
}
