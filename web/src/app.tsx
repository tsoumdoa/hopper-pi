import { Box, Power } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedBrowserCommand } from "../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../src/protocol/shared-execution.js";
import { Composer, type ComposerHandle } from "./components/composer";
import { ConfirmDialog, type ConfirmRequest } from "./components/confirm-dialog";
import { ConnectionBanner } from "./components/connection-banner";
import { ExportSessionButton } from "./components/export-session-button";
import { ModelControls, toolbarTriggerClass } from "./components/model-picker";
import { ProviderDialog } from "./components/provider-dialog";
import { RhinoInstancesPanel, summarizeInstances } from "./components/rhino-instances";
import { Sidebar } from "./components/sidebar";
import { SkillsDialog } from "./components/skills-dialog";
import { TaskThread, TaskWorkingTime } from "./components/task-thread";
import { ToastRegion } from "./components/toasts";
import { ToolsDialog } from "./components/tools-dialog";
import { UiRequestDialog } from "./components/ui-request-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import type { DraftImage } from "./lib/image-attachments";
import { cn, providerLabel } from "./lib/utils";
import { useHopperStore, useHopperStoreApi } from "./state/hopper-store-context";
import type { ConnectionStatus, SendMode } from "./state/hopper-types";
import { CONNECTED_DETAIL } from "./state/initial-state";
import { handleServerMessage } from "./state/server-messages";
import { bindingLabeler, decode, readyTargets, sameBinding, type Row, type SharedSnapshot } from "./state/shared-snapshot";

const SIDEBAR_KEY = "hopper.sidebar.collapsed";
const ACTIVE_ROOT_STATES = ["running", "suspending", "awaiting_user"];

function readCollapsed() {
	try {
		return window.localStorage.getItem(SIDEBAR_KEY) === "1";
	} catch {
		return false;
	}
}

/** The browser credential arrives in the URL hash once; afterwards it lives in session storage. */
function readCredential(): string {
	const hash = location.hash.slice(1);
	const raw = new URLSearchParams(hash).get("token") || (hash.includes("=") ? "" : hash);
	if (raw) {
		sessionStorage.setItem("hopper.token", raw);
		history.replaceState(null, "", location.pathname);
	}
	return raw || sessionStorage.getItem("hopper.token") || "";
}

function StatusPill({ status, activeRoot, turns }: { status: ConnectionStatus; activeRoot: Row | undefined; turns: Row[] }) {
	if (status !== "connected") {
		const label = { connecting: "Connecting", authenticating: "Authenticating", disconnected: "Offline", error: "Offline" }[status];
		const lost = status === "disconnected" || status === "error";
		return <Badge variant={lost ? "danger" : "warn"} dot pulse={!lost}>{label}</Badge>;
	}
	if (!activeRoot) return <Badge dot>Ready</Badge>;
	if (activeRoot.state === "awaiting_user") return <Badge variant="warn" dot>Answer needed</Badge>;
	return (
		<Badge variant="accent" dot pulse className="max-w-[240px] [&>span:last-child]:truncate">
			<span>
				<span className="sm:hidden">Working</span>
				<span className="max-sm:hidden">
					{activeRoot.state === "suspending" ? "Finishing current operation…" : <TaskWorkingTime task={activeRoot} turns={turns} inline />}
				</span>
			</span>
		</Badge>
	);
}

export function App() {
	const store = useHopperStoreApi();
	const connection = useHopperStore((state) => state.connection);
	const authCompletedCount = useHopperStore((state) => state.auth.completedCount);
	const connected = connection.status === "connected";

	const [providerOpen, setProviderOpen] = useState(false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

	const [snapshot, setSnapshot] = useState<SharedSnapshot>();
	const [conversationId, setConversationId] = useState("");
	const [selected, setSelected] = useState<TargetBinding[]>([]);
	const selectionExplicit = useRef(false);
	const initialInstance = useRef(new URLSearchParams(window.location.search).get("instance"));
	const initialDocument = useRef(new URLSearchParams(window.location.search).get("document"));
	const [onlyThisInstance, setOnlyThisInstance] = useState(false);
	const selectTargets = (bindings: TargetBinding[]) => { selectionExplicit.current = true; setSelected(bindings); };
	const [draft, setDraft] = useState("");
	const [images, setImages] = useState<DraftImage[]>([]);
	// Explicit delivery choice made while a task runs; null means the default for the current state.
	const [modeOverride, setModeOverride] = useState<SendMode | null>(null);
	const [nonce, setNonce] = useState(0);
	const composer = useRef<ComposerHandle>(null);
	const currentConversation = useRef(conversationId);
	currentConversation.current = conversationId;

	const socket = useRef<WebSocket>(undefined);
	const credential = useRef<string>(undefined);
	const ready = useRef(false);
	const startupRequested = useRef(false);
	const pending = useRef(new Map<string, SharedBrowserCommand>());
	const [, refreshPending] = useState(0);
	const blocked = useRef(false);

	const toast = useCallback((message: string, level: "error" | "warning" | "info" = "error") => store.getState().actions.toast(message, level), [store]);

	useEffect(() => {
		try {
			window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
		} catch {
			// Storage may be unavailable; the preference is only a convenience.
		}
	}, [sidebarCollapsed]);

	// A completed sign-in closes the provider dialog.
	useEffect(() => {
		if (authCompletedCount > 0) setProviderOpen(false);
	}, [authCompletedCount]);

	useEffect(() => {
		const actions = store.getState().actions;
		if (credential.current === undefined) credential.current = readCredential();
		if (!credential.current) {
			actions.setConnection("error", "Run _HopperCode in Rhino to open Hopper.");
			return;
		}
		let disposed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const isCurrent = () => !disposed && socket.current === ws;
		const retry = () => {
			if (!isCurrent() || blocked.current) return;
			ready.current = false;
			socket.current = undefined;
			if (deadline) clearTimeout(deadline);
			if (timer) clearTimeout(timer);
			actions.setBackendDetail("Hopper Code instances unknown while offline");
			actions.setConnection("disconnected", "Reconnecting to the local Hopper host…");
			ws.close();
			timer = setTimeout(() => setNonce((n) => n + 1), 1500);
		};
		const armDeadline = () => {
			if (deadline) clearTimeout(deadline);
			deadline = setTimeout(retry, 10_000);
		};
		actions.setConnection("connecting", nonce ? "Reconnecting to the local Hopper host" : "Opening the local Hopper host");
		const url = new URL("/ws-shared", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		socket.current = ws;
		ready.current = false;
		ws.onopen = () => {
			if (!isCurrent()) return;
			actions.setConnection("authenticating", "Confirming the Rhino session");
			try { ws.send(JSON.stringify({ type: "authenticate", token: credential.current })); } catch { retry(); }
		};
		ws.onmessage = (event) => {
			if (!isCurrent()) return;
			let message;
			try { message = JSON.parse(String(event.data)); }
			catch { toast("Hopper sent an unreadable message."); return; }
			if (!message || typeof message !== "object") return;
			switch (message.type) {
				case "shared_snapshot": {
					if (deadline) clearTimeout(deadline);
					deadline = undefined;
					const next = message.snapshot as SharedSnapshot;
					setSnapshot(next);
					actions.applySnapshot(next.runtime);
					const available = readyTargets(next).length;
					actions.setBackendDetail(`${available} Rhino ${available === 1 ? "instance" : "instances"} connected`);
					actions.setConnection("connected", CONNECTED_DETAIL, 0);
					if (!ready.current) {
						ready.current = true;
						// A new page starts a fresh chat. Reconnects retry the same request.
						if (!startupRequested.current) {
							startupRequested.current = true;
							const command: SharedBrowserCommand = { type: "create_conversation", requestId: crypto.randomUUID(), title: "New chat" };
							pending.current.set(command.requestId, command);
						}
						try {
							for (const command of pending.current.values()) ws.send(JSON.stringify(command));
							ws.send(JSON.stringify({ type: "snapshot" }));
						} catch { retry(); }
					}
					break;
				}
				case "command_accepted": {
					const accepted = pending.current.get(message.requestId);
					pending.current.delete(message.requestId);
					refreshPending((value) => value + 1);
					if ((accepted?.type === "submit" || accepted?.type === "steer") && accepted.conversationId === currentConversation.current) {
						setDraft((current) => (current === accepted.text ? "" : current));
						setImages((current) => current.filter((image) => !accepted.attachments.some((attachment) => JSON.stringify(attachment) === JSON.stringify(image.image))));
						if (message.result?.admissionError) toast(String(message.result.admissionError), "warning");
					}
					if (accepted?.type === "create_conversation") {
						setConversationId(message.result.conversationId);
						selectionExplicit.current = false;
						setSelected([]);
						setDraft("");
						setImages([]);
					}
					break;
				}
				case "error": {
					pending.current.delete(message.requestId);
					refreshPending((value) => value + 1);
					if (store.getState().auth.busy) actions.failAuth(message.message);
					toast(message.message);
					break;
				}
				case "auth_event":
					handleServerMessage(store, message);
					if (message.event?.type === "success") setProviderOpen(false);
					break;
				case "tool_settings":
				case "ui_request":
				case "ui_notification":
					handleServerMessage(store, message);
					break;
			}
		};
		ws.onclose = (event) => {
			if (!isCurrent()) return;
			if (deadline) clearTimeout(deadline);
			ready.current = false;
			actions.setBackendDetail("Hopper Code instances unknown while offline");
			blocked.current = event.code === 4001 || event.code === 4003;
			if (blocked.current) {
				socket.current = undefined;
				actions.setConnection(event.code === 4003 ? "error" : "disconnected", event.code === 4003
					? `${event.reason || "Authentication failed"}. Run _HopperCode in Rhino to open a fresh link.`
					: `${event.reason || "Disconnected"}. Reconnect to take control in this tab.`);
			} else {
				retry();
			}
		};
		ws.onerror = retry;
		armDeadline();
		// A half-open socket can survive sleep without receiving a close event.
		const probe = () => {
			if (!isCurrent() || !ready.current || deadline) return;
			armDeadline();
			try { ws.send(JSON.stringify({ type: "snapshot" })); } catch { retry(); }
		};
		const wake = () => {
			if (disposed || blocked.current) return;
			if (socket.current === ws && ws.readyState === WebSocket.OPEN && ready.current) probe();
			else setNonce((n) => n + 1);
		};
		const visible = () => { if (document.visibilityState === "visible") wake(); };
		const heartbeat = setInterval(probe, 15_000);
		window.addEventListener("online", wake);
		window.addEventListener("pageshow", wake);
		document.addEventListener("visibilitychange", visible);
		return () => {
			disposed = true;
			ready.current = false;
			if (socket.current === ws) socket.current = undefined;
			if (timer) clearTimeout(timer);
			if (deadline) clearTimeout(deadline);
			clearInterval(heartbeat);
			window.removeEventListener("online", wake);
			window.removeEventListener("pageshow", wake);
			document.removeEventListener("visibilitychange", visible);
			ws.close();
		};
	}, [nonce, store, toast]);

	const send = (command: SharedBrowserCommand) => {
		if (!ready.current || socket.current?.readyState !== WebSocket.OPEN) {
			toast("Hopper is still connecting. Try again in a moment.", "warning");
			return false;
		}
		// Retain only non-secret durable commands for network retries.
		if ("requestId" in command && command.type !== "auth_response") {
			pending.current.set(command.requestId, command);
			refreshPending((value) => value + 1);
		}
		try { socket.current.send(JSON.stringify(command)); }
		catch {
			ready.current = false;
			setNonce((n) => n + 1);
			toast("Connection lost. Your draft is retained while Hopper reconnects.", "warning");
			return false;
		}
		return true;
	};
	const reconnect = () => {
		blocked.current = false;
		credential.current = readCredential();
		setNonce((n) => n + 1);
	};

	const tasks = snapshot?.tasks.filter((task) => task.conversation_id === conversationId) ?? [];
	const orderedTasks = tasks
		.filter((task) => task.parent_task_id === null)
		.flatMap((root) => [root, ...tasks.filter((task) => task.parent_task_id === root.id)]);
	const sessionId = String(snapshot?.sessions.find((session) => session.conversation_id === conversationId && !String(session.id).startsWith("worker-"))?.id ?? "");
	const selectedModel = snapshot?.runtime.models.find((model) => model.provider === snapshot.runtime.model?.provider && model.id === snapshot.runtime.model?.id);
	const imagesSupported = selectedModel?.input?.includes("image") !== false;
	const submitting = [...pending.current.values()].some((command) => (command.type === "submit" || command.type === "steer") && command.conversationId === conversationId);
	const activeRoot = tasks.find((task) => task.parent_task_id === null && ACTIVE_ROOT_STATES.includes(String(task.state)));
	const cancellableRoot = activeRoot ?? tasks.find((task) => task.parent_task_id === null && task.state === "queued");
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
	const activeOwner = decode<{ binding?: TargetBinding } | null>(activeTurn?.owner, null);
	const activeInput = decode<{ bindings: TargetBinding[]; messageTarget?: TargetBinding }>(activeRoot?.payload, { bindings: [] });
	const activeBindings = activeOwner?.binding ? [activeOwner.binding] : activeInput.messageTarget ? [activeInput.messageTarget] : activeInput.bindings;
	const steeringDestination = activeBindings.length ? activeBindings.map(labelFor).join(", ") : "Conversation";
	const unavailableSelected = selected.some((binding) => !availableTargets.some((target) => target.documents.some((document) => sameBinding(document, binding))));
	const needsTarget = sendMode !== "steer" && Boolean(
		unavailableSelected || (documentBindings.length > 0 && !selected.length),
	);
	const title = String(snapshot?.conversations.find((conversation) => conversation.id === conversationId)?.title ?? "New chat");

	useEffect(() => {
		document.title = conversationId ? `${title} · Hopper` : "Hopper";
	}, [conversationId, title]);
	// Focus the composer when the host becomes ready or a new chat starts.
	useEffect(() => {
		if (connected && sessionId) composer.current?.focus();
	}, [connected, conversationId, sessionId]);

	const submit = () => {
		if (needsTarget) {
			toast("Choose a connected document first.", "warning");
			return;
		}
		if ((!draft.trim() && !images.length) || !sessionId || (images.length && !imagesSupported)) return;
		const attachments = images.map((image) => image.image);
		const duplicate = [...pending.current.values()].some(
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
			send({ type: "steer", requestId: crypto.randomUUID(), conversationId, sessionId: String(task.session_id), taskId: String(task.id), turnId: String(turn.id), text: draft, attachments });
			return;
		}
		send({ type: "submit", requestId: crypto.randomUUID(), conversationId, sessionId, kind: sendMode, text: draft, bindings: accessibleBindings, ...(selected[0] ? { messageTarget: selected[0] } : {}), attachments });
	};

	const cancelTask = (taskId: string) => send({ type: "cancel", requestId: crypto.randomUUID(), conversationId, taskId });
	const commands = {
		answer: (questionId: string, answer: string | null) => send({ type: "answer", requestId: crypto.randomUUID(), conversationId, questionId, answer }),
		recover: (taskId: string, acknowledgement: string) => send({ type: "recover", requestId: crypto.randomUUID(), conversationId, taskId, acknowledgement }),
		recoverLaunch: (taskId: string, launchRequestId: string, acknowledgement: string) =>
			send({ type: "recover_launch", requestId: crypto.randomUUID(), conversationId, taskId, launchRequestId, acknowledgement }),
	};

	const newChat = () => {
		const start = () => send({ type: "create_conversation", requestId: crypto.randomUUID(), title: "New chat" });
		if (activeRoot) {
			setConfirm({
				title: "Start a new chat?",
				description: "Hopper is still working in this chat. The work keeps running in Rhino, but you cannot return to this chat afterwards.",
				confirmLabel: "New chat",
				action: start,
			});
			return;
		}
		start();
	};
	const shutdown = () =>
		setConfirm({
			title: "Shut down the Hopper host?",
			description: "This stops the local Hopper host and cancels pending work. Rhino documents stay open, and Rhino can start Hopper again with _HopperCode.",
			confirmLabel: "Shut down",
			destructive: true,
			action: () => {
				if (snapshot) send({ type: "stop_host", requestId: crypto.randomUUID(), hostEpoch: snapshot.hostEpoch });
			},
		});
	const requestLogout = (provider: string) =>
		setConfirm({
			title: `Log out of ${providerLabel(provider, store.getState().providers)}?`,
			description: "Hopper forgets the saved credential for this provider. Models from it stop being available until you sign in again.",
			confirmLabel: "Log out",
			destructive: true,
			action: () => send({ type: "logout", provider }),
		});
	const openProvider = useCallback(() => {
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
		<Button variant="ghost" size="sm" aria-label="Instance access" aria-pressed={onlyThisInstance} title="Choose which Hopper Code instances this message can access" disabled={!connected || sendMode === "steer" || submitting} onClick={() => setOnlyThisInstance((value) => !value)}>{onlyThisInstance ? "Only this instance" : "All instances"}</Button>
		</>
	);

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink lg:flex-row">
			<a className="skip-link" href="#composer-input">Skip to message</a>
			<Sidebar
				token={credential.current ?? ""}
				connected={connected}
				collapsed={sidebarCollapsed}
				onCollapsedChange={setSidebarCollapsed}
				mobileOpen={mobileSettingsOpen}
				onMobileOpenChange={setMobileSettingsOpen}
				onNewSession={newChat}
				onManageProvider={openProvider}
				onManageSkills={() => { setMobileSettingsOpen(false); setSkillsOpen(true); }}
				onViewTools={() => { setMobileSettingsOpen(false); setToolsOpen(true); }}
				onReconnect={reconnect}
				rhino={{ summary: summarizeInstances(snapshot, connected), panel: <RhinoInstancesPanel snapshot={snapshot} connected={connected} /> }}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
					<h1 className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight">{title}</h1>
					<ExportSessionButton token={credential.current ?? ""} conversationId={conversationId} disabled={!connected || !conversationId} />
					<StatusPill status={connection.status} activeRoot={activeRoot} turns={snapshot?.turns ?? []} />
					<Button size="icon-sm" variant="ghost" className="-mr-1.5" disabled={!connected || !snapshot} onClick={shutdown} aria-label="Shut down the Hopper host" title="Shut down the Hopper host">
						<Power className="size-3.5" />
					</Button>
				</header>
				<ConnectionBanner connection={connection} onReconnect={reconnect} />
				<TaskThread
					snapshot={snapshot}
					tasks={orderedTasks}
					connected={connected}
					conversationId={conversationId}
					labelFor={labelFor}
					commands={commands}
					onSuggestion={useSuggestion}
				/>
				<Composer
					key={conversationId}
					ref={composer}
					draft={draft}
					onDraftChange={setDraft}
					images={images}
					onImagesChange={setImages}
					imagesSupported={imagesSupported}
					mode={sendMode}
					onModeChange={setModeOverride}
					disabled={!sessionId || !connected || submitting || taskBlocksComposer}
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
								onManageProvider={openProvider}
							/>
							{rhinoPicker}
						</>
					}
				/>
			</main>


			{providerOpen && (
				<ProviderDialog
					onOpenChange={setProviderOpen}
					onLogin={(provider, authType, apiKey) => {
						store.getState().actions.startAuth(provider, "Signing in");
						return send({ type: "login", provider, authType, ...(apiKey ? { apiKey } : {}) });
					}}
					onLogout={requestLogout}
				/>
			)}
			{skillsOpen && <SkillsDialog token={credential.current ?? ""} connected={connected} streaming={Boolean(activeRoot)} onOpenChange={setSkillsOpen} />}
			{toolsOpen && <ToolsDialog key={sessionId} token={credential.current ?? ""} connected={connected} onOpenChange={setToolsOpen} />}
			<UiRequestDialog send={(message) => message.type === "ui_response" && send({ type: "auth_response", requestId: message.requestId, value: message.value })} />
			<ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
			<ToastRegion />
		</div>
	);
}
