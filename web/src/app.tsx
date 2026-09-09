import { ExportSessionButton } from "./components/export-session-button";
import { UiRequestDialog } from "./components/ui-request-dialog";
import { ToastRegion } from "./components/toasts";
import { handleServerMessage } from "./state/server-messages";
import { Box, Power } from "lucide-react";
import { Sidebar } from "./components/sidebar";
import { ModelControls, toolbarTriggerClass } from "./components/model-picker";
import { ProviderDialog } from "./components/provider-dialog";
import { SkillsDialog } from "./components/skills-dialog";
import { ToolsDialog } from "./components/tools-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { useHopperStoreApi } from "./state/hopper-store-context";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SharedBrowserCommand } from "../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../src/protocol/shared-execution.js";
import type { HostSnapshot } from "../../src/host/protocol.js";
import { MessageMarkdown } from "./components/message-markdown";
import { WorkingTime } from "./components/working-time";
import { Composer, type ComposerHandle } from "./components/composer";
import { ToolCard } from "./components/conversation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { imageUrl, type DraftImage } from "./lib/image-attachments";
import { parseImages } from "../../src/host/protocol";
import type { ToolCall } from "./state/hopper-types";

type Row = Record<string, string | number | null>;
type Snapshot = {
	hostEpoch: string;
	conversations: Row[];
	sessions: Row[];
	tasks: Row[];
	turns: Row[];
	events: Row[];
	records?: Row[];
	recoveries: Row[];
	questions: Row[];
	inputs?: Row[];
	targets: {
		label: string;
		lifecycleInstanceId: string;
		processId: number;
		admission: string;
		documents: TargetBinding[];
		documentLabels?: Record<string, string>;
	}[];
	installations?: {
		id: string;
		platform?: string;
		build: string;
		bootstrapVerified: boolean;
		unavailableReason?: string;
	}[];
	runtime: HostSnapshot;
	eventCursor: number;
};
function token(): string {
	const raw = location.hash.slice(1);
	if (raw) {
		sessionStorage.setItem("hopper.token", raw);
		history.replaceState(null, "", location.pathname);
	}
	return raw || sessionStorage.getItem("hopper.token") || "";
}
function decode<T>(value: unknown, fallback: T): T {
	try {
		return JSON.parse(String(value)) as T;
	} catch {
		return fallback;
	}
}
function targetName(
	binding: TargetBinding,
	labels?: Record<string, string>,
): string {
	return binding.kind === "rhino"
		? (labels?.[binding.rhinoDocumentId] ?? "Untitled Rhino document")
		: `${labels?.[binding.grasshopperDocumentId] ?? "Untitled Grasshopper document"}${binding.associatedRhinoDocumentId ? ` / ${labels?.[binding.associatedRhinoDocumentId] ?? "Rhino document"}` : ""}`;
}

function TaskWorkingTime({ task, turns, inline = false }: {
 task: Row;
 turns: Row[];
 inline?: boolean;
}) {
 const timestamps = turns
  .filter((turn) => turn.task_id === task.id)
  .map((turn) => Number(turn.started_at))
  .filter((time) => Number.isFinite(time) && time > 0);
 const startedAt = timestamps.length ? Math.min(...timestamps) : Number(task.created_at) || undefined;
 if (task.state === "awaiting_user")
  return inline ? <span>Answer needed</span> : <p role="status" className="mb-3 border-b border-line/60 pb-3 text-[13px] text-muted">Waiting for your answer</p>;
 const streaming = task.state === "running" || task.state === "suspending";
 const finishedAt = streaming ? undefined : Number(task.updated_at) || undefined;
 return <WorkingTime streaming={streaming} startedAt={startedAt} finishedAt={finishedAt} inline={inline} />;
}

function taskTools(events: Row[]): ToolCall[] {
	const tools = new Map<string, ToolCall>();
	for (const event of events) {
		const payload = decode<any>(event.payload, {});
		if (payload.type === "messages") {
			for (const message of payload.messages ?? []) {
				if (message.role === "assistant") for (const part of message.content ?? []) {
					if (part.type !== "toolCall") continue;
					const id = String(part.id ?? part.toolCallId ?? "tool");
					tools.set(id, { id, name: String(part.name ?? part.toolName ?? "Tool call"), args: part.arguments, detail: part.arguments, status: "complete" });
				}
				if (message.role === "toolResult") {
					const id = String(message.toolCallId ?? "tool"), prior = tools.get(id);
					const text = Array.isArray(message.content) ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") : undefined;
					tools.set(id, { id, name: String(message.toolName ?? prior?.name ?? "Tool call"), args: prior?.args, detail: message.details ?? text ?? prior?.detail, status: message.isError ? "error" : "complete" });
				}
			}
		}
		if (payload.type === "tool_progress") {
			const id = String(payload.toolCallId ?? "tool"), prior = tools.get(id);
			tools.set(id, { id, name: String(payload.toolName ?? prior?.name ?? "Tool call"), args: prior?.args, detail: prior?.detail ?? prior?.args, status: payload.phase === "started" ? "running" : payload.isError ? "error" : "complete" });
		}
	}
	return [...tools.values()];
}

type LiveAssistantMessage = { turnId: string; text: string; thinking: string };

function liveAssistantMessages(
	events: Row[],
	completedTurns: Set<string>,
): LiveAssistantMessage[] {
	const messages = new Map<string, LiveAssistantMessage>();
	for (const row of events) {
		const payload = decode<any>(row.payload, {});
		if (payload.type !== "agent_event" || !payload.turnId) continue;
		const event = payload.event ?? {};
		const turnId = String(payload.turnId);
		if (event.type === "message_start") {
			if (event.message?.role === "assistant")
				messages.set(turnId, { turnId, text: "", thinking: "" });
			continue;
		}
		const message = messages.get(turnId);
		if (!message) continue;
		if (event.type === "message_update") {
			const update = event.assistantMessageEvent ?? {};
			if (update.type === "text_delta")
				message.text += String(update.delta ?? update.text ?? "");
			if (update.type === "thinking_delta")
				message.thinking += String(update.delta ?? update.text ?? "");
			continue;
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const content = Array.isArray(event.message.content)
				? event.message.content
				: [];
			const text = content
				.filter((part: any) => part.type === "text")
				.map((part: any) => String(part.text ?? ""))
				.join("\n");
			const thinking = content
				.filter((part: any) => part.type === "thinking")
				.map((part: any) => String(part.thinking ?? part.text ?? ""))
				.join("\n");
			if (text) message.text = text;
			if (thinking) message.thinking = thinking;
		}
	}
	return [...messages.values()].filter(
		(message) => !completedTurns.has(message.turnId),
	);
}

export function App() {
	const store = useHopperStoreApi();
	const [providerOpen, setProviderOpen] = useState(false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		try {
			return window.localStorage.getItem("hopper.sidebar.collapsed") === "1";
		} catch {
			return false;
		}
	});
	useEffect(() => {
		try {
			window.localStorage.setItem(
				"hopper.sidebar.collapsed",
				sidebarCollapsed ? "1" : "0",
			);
		} catch {}
	}, [sidebarCollapsed]);
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [conversationId, setConversationId] = useState("");
	const [selected, setSelected] = useState<TargetBinding[]>([]);
	const [text, setText] = useState("");
	const [images, setImages] = useState<DraftImage[]>([]);
	const composer = useRef<ComposerHandle>(null);
	const conversationScroller = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const [showJump, setShowJump] = useState(false);
	const currentConversation = useRef(conversationId);
	currentConversation.current = conversationId;
	const [modeOverride, setSendMode] = useState<
		"prompt" | "follow_up" | "steer" | null
	>(null);
	const [status, setStatus] = useState("Connecting");
	const [error, setError] = useState("");
	const [nonce, setNonce] = useState(0);

	const socket = useRef<WebSocket | undefined>(undefined);
	const credential = useRef<string>(undefined);
	const ready = useRef(false);
	const startupRequested = useRef(false);
	const pending = useRef(new Map<string, SharedBrowserCommand>());
	const [, refreshPending] = useState(0);
	const blocked = useRef(false);
	useEffect(() => {
		if (credential.current === undefined) credential.current = token();
		if (!credential.current) {
			setStatus("Run HopperCode in Rhino to open Hopper.");
			return;
		}
		let disposed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const url = new URL("/ws-shared", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		socket.current = ws;
		ready.current = false;
		ws.onopen = () =>
			ws.send(
				JSON.stringify({ type: "authenticate", token: credential.current }),
			);
		ws.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.type === "shared_snapshot") {
				setSnapshot(message.snapshot);
				store.getState().actions.applySnapshot(message.snapshot.runtime);
				const targets = message.snapshot.targets as Snapshot["targets"];
				const available = targets.filter(
					(target) => target.admission === "ready",
				).length;
				store
					.getState()
					.actions.setBackendDetail(
						`${available} Rhino ${available === 1 ? "instance" : "instances"} connected`,
					);
				store
					.getState()
					.actions.setConnection("connected", "Connected to Hopper");
				setStatus("Connected");
				if (!ready.current) {
					ready.current = true;
					// A new page starts a fresh chat. Reconnects retry the same request.
					if (!startupRequested.current) {
						startupRequested.current = true;
						const command: SharedBrowserCommand = {
							type: "create_conversation",
							requestId: crypto.randomUUID(),
							title: "New chat",
						};
						pending.current.set(command.requestId, command);
					}
					for (const command of pending.current.values())
						ws.send(JSON.stringify(command));
					ws.send(JSON.stringify({ type: "snapshot" }));
				}
			} else if (message.type === "command_accepted") {
				const accepted = pending.current.get(message.requestId);
				pending.current.delete(message.requestId);
				refreshPending((value) => value + 1);
				if (
					(accepted?.type === "submit" || accepted?.type === "steer") &&
					accepted.conversationId === currentConversation.current
				) {
					setText((current) => (current === accepted.text ? "" : current));
					setImages((current) =>
						current.filter(
							(image) =>
								!accepted.attachments.some(
									(attachment) =>
										JSON.stringify(attachment) === JSON.stringify(image.image),
								),
						),
					);
					if (message.result?.admissionError)
						setError(message.result.admissionError);
				}
				if (accepted?.type === "create_conversation") {
					setConversationId(message.result.conversationId);
					setSelected([]);
					setText("");
					setImages([]);
				}
			} else if (message.type === "error") {
				pending.current.delete(message.requestId);
				refreshPending((value) => value + 1);
				setError(message.message);
				if (store.getState().auth.busy)
					store.getState().actions.failAuth(message.message);
			} else if (message.type === "ui_request") {
				handleServerMessage(store, message);
			} else if (message.type === "auth_event") {
				handleServerMessage(store, message);
				if (message.event?.type === "success") setProviderOpen(false);
			} else if (message.type === "status") {
				handleServerMessage(store, message);
				if (
					message.scope === "auth" &&
					["authenticated", "logged_in", "connected"].includes(message.status)
				)
					setProviderOpen(false);
			}
		};
		ws.onclose = (event) => {
			if (disposed) return;
			ready.current = false;
			store
				.getState()
				.actions.setConnection("disconnected", "Reconnecting to Hopper");
			blocked.current = event.code === 4001 || event.code === 4003;
			setStatus(
				blocked.current
					? `${event.reason}. Use Reconnect to take control.`
					: "Host disconnected. Reconnecting…",
			);
			if (!blocked.current)
				timer = setTimeout(() => setNonce((n) => n + 1), 1500);
		};
		return () => {
			disposed = true;
			if (timer) clearTimeout(timer);
			ws.close();
		};
	}, [nonce]);
	const send = (command: SharedBrowserCommand) => {
		if (!ready.current || socket.current?.readyState !== WebSocket.OPEN) {
			setError("Wait for a fresh host snapshot before sending commands.");
			return false;
		}
		// Retain only non-secret durable commands for network retries.
		if ("requestId" in command && command.type !== "auth_response") {
			pending.current.set(command.requestId, command);
			refreshPending((value) => value + 1);
		}
		socket.current.send(JSON.stringify(command));
		setError("");
		return true;
	};
	const currentTasks =
		snapshot?.tasks.filter((task) => task.conversation_id === conversationId) ??
		[];
	const orderedTasks = currentTasks
		.filter((task) => task.parent_task_id === null)
		.flatMap((root) => [
			root,
			...currentTasks.filter((task) => task.parent_task_id === root.id),
		]);
	const sessionId = String(
		snapshot?.sessions.find(
			(session) =>
				session.conversation_id === conversationId &&
				!String(session.id).startsWith("worker-"),
		)?.id ?? "",
	);
	const selectedModel = snapshot?.runtime.models.find(
		(model) =>
			model.provider === snapshot.runtime.model?.provider &&
			model.id === snapshot.runtime.model?.id,
	);
	const imagesSupported = selectedModel?.input?.includes("image") !== false;
	const submitting = [...pending.current.values()].some(
		(command) =>
			(command.type === "submit" || command.type === "steer") &&
			command.conversationId === conversationId,
	);
	const activeRoot = currentTasks.find(
		(task) =>
			task.parent_task_id === null &&
			["running", "suspending", "awaiting_user"].includes(String(task.state)),
	);
	const taskIsRunning = activeRoot?.state === "running";
	const taskBlocksComposer =
		activeRoot?.state === "suspending" || activeRoot?.state === "awaiting_user";
	const sendMode = modeOverride ?? (taskIsRunning ? "follow_up" : "prompt");
	useEffect(() => {
		if (!taskIsRunning) setSendMode(null);
	}, [taskIsRunning]);
	const availableTargets =
		snapshot?.targets.filter((target) => target.admission === "ready") ?? [];
	const modelBindings = availableTargets.flatMap((target) =>
		target.documents.filter((binding) => binding.kind === "rhino"),
	);
	useEffect(() => {
		if (!selected.length && modelBindings.length) setSelected([modelBindings[0]!]);
	}, [snapshot, selected.length]);
	const bindingLabel = (binding: TargetBinding) => {
		const target = snapshot?.targets.find(
			(target) => target.lifecycleInstanceId === binding.lifecycleInstanceId,
		);
		const name = targetName(binding, target?.documentLabels);
		const index =
			target?.documents.findIndex(
				(document) => JSON.stringify(document) === JSON.stringify(binding),
			) ?? -1;
		const label =
			(name.startsWith("Untitled") ||
				(target?.documents.filter(
					(document) => targetName(document, target.documentLabels) === name,
				).length ?? 0) > 1) &&
			index >= 0
				? `${name} ${index + 1}`
				: name;
		return availableTargets.length > 1 && target
			? `${label} · Rhino ${availableTargets.indexOf(target) + 1 || "offline"}`
			: label;
	};
	const activeTurn = snapshot?.turns.find(
		(turn) => turn.task_id === activeRoot?.id && turn.state === "running",
	);
	const activeOwner = decode<{ binding?: TargetBinding }>(
		activeTurn?.owner,
		{},
	);
	const activeBindings = activeOwner?.binding
		? [activeOwner.binding]
		: decode<{ bindings: TargetBinding[] }>(activeRoot?.payload, {
				bindings: [],
			}).bindings;
	const steeringDestination = activeBindings.length
		? activeBindings.map(bindingLabel).join(", ")
		: "Conversation";
	const unavailableSelected = selected.some(
		(binding) =>
			!snapshot?.targets.some(
				(target) =>
					target.admission === "ready" &&
					target.documents.some(
						(document) => JSON.stringify(document) === JSON.stringify(binding),
					),
			),
	);
	const activeQuestionId = snapshot?.questions.find(
		(question) => question.task_id === activeRoot?.id && question.answer === null,
	)?.id;
	const title = String(
		snapshot?.conversations.find((conversation) => conversation.id === conversationId)
			?.title ?? "New chat",
	);
	const compactHeaderStatus = !ready.current
		? status === "Connecting" || status === "Authenticating"
			? "Connecting"
			: "Offline"
		: activeRoot?.state === "awaiting_user"
			? "Answer needed"
			: activeRoot
				? "Working"
				: "Ready";
	useEffect(() => {
		document.title = conversationId ? `${title} · Hopper` : "Hopper";
	}, [conversationId, title]);
	useEffect(() => {
		if (ready.current && sessionId) composer.current?.focus();
	}, [conversationId, sessionId]);
	const onConversationScroll = () => {
		const node = conversationScroller.current;
		if (!node) return;
		const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
		stickToBottom.current = distance < 80;
		setShowJump(distance > 240);
	};
	const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
		const node = conversationScroller.current;
		if (!node) return;
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : behavior });
	};
	useLayoutEffect(() => {
		if (activeQuestionId) stickToBottom.current = true;
		if (stickToBottom.current) scrollToLatest("auto");
	}, [activeQuestionId, conversationId, snapshot?.eventCursor, currentTasks.length]);
	const submit = () => {
		if (
			sendMode !== "steer" && (unavailableSelected || !selected.length)
		) {
			setError(
				"Choose an available Rhino model.",
			);
			return;
		}
		if (
			(!text.trim() && !images.length) ||
			!sessionId ||
			(images.length && !imagesSupported)
		)
			return;
		if (
			[...pending.current.values()].some(
				(command) =>
					(command.type === "submit" || command.type === "steer") &&
					command.conversationId === conversationId &&
					command.text === text &&
					JSON.stringify(command.attachments) ===
						JSON.stringify(images.map((image) => image.image)),
			)
		)
			return;
		if (sendMode === "steer") {
			const task = currentTasks.find(
				(task) => task.parent_task_id === null && task.state === "running",
			);
			const turn = snapshot?.turns.find(
				(turn) => turn.task_id === task?.id && turn.state === "running",
			);
			if (!task || !turn) {
				setError("There is no active root turn to steer.");
				return;
			}
			send({
				type: "steer",
				requestId: crypto.randomUUID(),
				conversationId,
				sessionId: String(task.session_id),
				taskId: String(task.id),
				turnId: String(turn.id),
				text,
				attachments: images.map((image) => image.image),
			});
			return;
		}
		send({
			type: "submit",
			requestId: crypto.randomUUID(),
			conversationId,
			sessionId,
			kind: sendMode,
			text,
			bindings: selected,
			attachments: images.map((image) => image.image),
		});
	};
	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink lg:flex-row">
			<a className="skip-link" href="#composer-input">
				Skip to message
			</a>
			<Sidebar
				token={credential.current ?? ""}
				connected={ready.current}
				collapsed={sidebarCollapsed}
				onCollapsedChange={setSidebarCollapsed}
				mobileOpen={mobileSettingsOpen}
				onMobileOpenChange={setMobileSettingsOpen}
				onNewSession={() =>
					send({
						type: "create_conversation",
						requestId: crypto.randomUUID(),
						title: "New chat",
					})
				}
				onManageProvider={() => { setMobileSettingsOpen(false); setProviderOpen(true); }}
				onManageSkills={() => { setMobileSettingsOpen(false); setSkillsOpen(true); }}
				onViewTools={() => { setMobileSettingsOpen(false); setToolsOpen(true); }}
				onReconnect={() => {
					blocked.current = false;
					setNonce((n) => n + 1);
				}}
				// Conversation history stays hidden until resuming threads is supported.
				conversations={[]}
			/>
			<main className="flex-1 flex flex-col min-w-0 min-h-0">
				<header className="border-b px-4 py-3 sm:px-6">
					<div className="flex items-center gap-3">
						<h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">
							{title}
						</h2>
						<ExportSessionButton
							token={credential.current ?? ""}
							conversationId={conversationId}
							disabled={!ready.current || !conversationId}
						/>
						<Badge
							className="max-w-28 sm:max-w-[min(60vw,20rem)] [&>span:last-child]:truncate"
							dot
							variant={
								ready.current ? (activeRoot ? "accent" : "neutral") : "warn"
							}
						>
							<span className="truncate sm:hidden">{compactHeaderStatus}</span>
							<span className="hidden truncate sm:inline">
								{ready.current
									? activeRoot?.state === "suspending"
										? "Finishing current operation…"
										: activeRoot
											? <TaskWorkingTime task={activeRoot} turns={snapshot?.turns ?? []} inline />
											: "Ready"
									: status}
							</span>
						</Badge>
						<Button
							size="icon-sm"
							variant="ghost"
							disabled={!snapshot || !ready.current}
							aria-label="Shut down the Hopper host"
							title="Shut down the Hopper host"
							onClick={() => {
								if (
									window.confirm(
										"Stop Hopper and cancel pending work? Rhino documents will stay open.",
									)
								)
									send({
										type: "stop_host",
										requestId: crypto.randomUUID(),
										hostEpoch: snapshot!.hostEpoch,
									});
							}}
						>
							<Power className="size-3.5" />
						</Button>
					</div>
					{error && (
						<p role="alert" className="text-red-500 mt-2">
							{error}
						</p>
					)}
				</header>
					<div className="relative min-h-0 flex-1">
						<div
							ref={conversationScroller}
							onScroll={onConversationScroll}
							className="h-full overflow-y-auto px-5 py-8 space-y-8"
							aria-label="Conversation"
							aria-live="polite"
						>
					{orderedTasks.map((task) => {
						const input = decode<{
							text: string;
							bindings: TargetBinding[];
							attachments?: unknown;
						}>(task.payload, { text: "", bindings: [] });
						const events = snapshot!.events.filter(
							(event) => event.task_id === task.id && event.kind === "progress",
						);
						const turnMessages = new Map<string, any[]>();
						for (const event of events) {
							const payload = decode<any>(event.payload, {});
							if (payload.type === "messages")
								turnMessages.set(
									String(payload.turnId),
									payload.messages ?? [],
								);
						}
						const messages = [...turnMessages.values()].flat();
						const liveMessages = liveAssistantMessages(
							events,
							new Set(turnMessages.keys()),
						);
						const progress = events
							.map((event) => decode<any>(event.payload, {}))
							.filter((event) => event.type === "tool_progress")
							.at(-1);
						const progressLabel = progress
							? `${String(progress.toolName)
									.replaceAll("_", " ")
									.replace(
										/([a-z])([A-Z])/g,
										"$1 $2",
									)} ${progress.phase === "started" ? "is running" : progress.isError ? "returned an error" : "finished"}`
							: "";
							const questions = snapshot!.questions.filter(
								(q) => q.task_id === task.id,
							);
							const tools = taskTools(events);
						const content = (
							<article
								key={String(task.id)}
								className={`mx-auto max-w-3xl space-y-4 ${task.parent_task_id ? "mt-3" : ""}`}
							>
								<UserMessage
									text={input.text}
									attachments={input.attachments}
								/>
								{snapshot?.inputs
									?.filter((entry) => entry.task_id === task.id)
									.map((entry) => {
										const payload = decode<{
											text: string;
											attachments?: unknown;
										}>(entry.payload, { text: "" });
										return (
											<UserMessage
												key={String(entry.id)}
												text={payload.text}
												attachments={payload.attachments}
												status={
													entry.state === "not_applied"
														? "Not delivered"
														: entry.state === "unknown"
															? "Delivery unconfirmed"
															: undefined
												}
											/>
										);
									})}
								{[
									"queued",
									"failed",
									"interrupted",
									"cancelled",
								].includes(String(task.state)) && (
									<p role="status" className="text-xs text-muted">
										{task.state === "failed"
											? "Something went wrong. Please try again."
											: task.state === "interrupted"
												? "Connection interrupted."
												: task.state === "cancelled"
													? "Stopped"
													: task.state === "queued"
														? "Waiting…"
														: "Working…"}
									</p>
								)}
								{task.state !== "queued" && (
									<TaskWorkingTime task={task} turns={snapshot?.turns ?? []} />
								)}
								{progressLabel &&
									["running", "suspending"].includes(String(task.state)) && (
										<p role="status" className="text-xs mt-2">
											{progressLabel}
										</p>
									)}
								{input.bindings?.map((binding) => (
									<p
										key={JSON.stringify(binding)}
										className="text-xs text-muted mt-2"
									>
										Target: {bindingLabel(binding)}
									</p>
										))}
									{tools.length > 0 && (
										<div className="mt-3 grid gap-1">
											{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
										</div>
									)}
								{messages
									.filter((message: any) => message.role === "assistant")
									.map((message: any, i: number) => (
										<div key={i} className="mt-3">
											{message.content.some((part: any) => part.type === "thinking") && (
												<details className="mb-2 text-xs text-muted">
													<summary className="cursor-pointer">Thinking</summary>
													<p className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 leading-5">
														{message.content.filter((part: any) => part.type === "thinking").map((part: any) => part.thinking ?? part.text).join("\n")}
													</p>
												</details>
											)}
											{message.content
												.filter((part: any) => part.type === "text")
												.map((part: any, j: number) => (
													<MessageMarkdown key={j} text={part.text} />
												))}
										</div>
									))}
								{liveMessages.map((message) => (
									<div key={message.turnId} className="mt-3 min-w-0">
										{message.thinking && (
											<details className="mb-2 text-xs text-muted">
												<summary className="cursor-pointer">Thinking…</summary>
												<p className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 leading-5">{message.thinking}</p>
											</details>
										)}
										{message.text ? (
											<div className="min-w-0 text-[14px] leading-7">
												<MessageMarkdown text={message.text} />
												<span aria-hidden="true" className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-blink bg-accent" />
											</div>
										) : !message.thinking ? (
											<p className="text-xs text-muted" role="status">Getting started…</p>
										) : null}
									</div>
								))}
								{messages
									.filter(
										(message) =>
											message.role === "toolResult" &&
											Array.isArray(message.content),
									)
									.flatMap((message, i) =>
										message.content
											.filter((part: any) => part.type === "image")
											.map((part: any, j: number) => {
												let image;
												try {
													image = parseImages([part])?.[0];
												} catch {
													return null;
												}
												return image ? (
													<figure key={`capture-${i}-${j}`} className="mt-3">
														<img
															className="max-w-full rounded border"
															src={imageUrl(image)}
															alt={`Capture from ${message.toolName ?? "Rhino"}`}
														/>
														<figcaption className="text-xs mt-1">
															{message.toolName ?? "Rhino"}
														</figcaption>
													</figure>
												) : null;
											}),
									)}
								{questions.map((question) => (
									<Question
										key={String(question.id)}
										question={question}
										enabled={task.state === "awaiting_user"}
										inactive={[
											"completed",
											"cancelled",
											"failed",
											"interrupted",
											"uncertain",
										].includes(String(task.state))}
										answer={(answer) =>
											send({
												type: "answer",
												requestId: crypto.randomUUID(),
												conversationId,
												questionId: String(question.id),
												answer,
											})
										}
									/>
								))}
								{["running", "queued", "suspending", "awaiting_user"].includes(
									String(task.state),
								) && (
									<button
										className="mt-3 text-xs underline"
										onClick={() =>
											send({
												type: "cancel",
												requestId: crypto.randomUUID(),
												conversationId,
												taskId: String(task.id),
											})
										}
									>
										Stop
									</button>
								)}
								{(snapshot!.records ?? [])
									.filter(
										(record) =>
											record.kind === "launch" &&
											record.task_id === task.id &&
											["cancelled", "uncertain"].includes(
												String(record.state),
											) &&
											decode<any>(record.payload, {}).dispatchAttempted,
									)
									.map((record) => {
										const payload = decode<any>(record.payload, {});
										const supported = snapshot!.installations?.some(
											(installation: any) =>
												installation.id === payload.request?.installationId &&
												(installation.platform === "win32" ||
													(installation.platform === "darwin" &&
														!payload.request?.independentProcess)),
										);
										const recovered = snapshot!.records?.some(
											(row) =>
												row.kind === "launch_recovery" &&
												row.id === record.id &&
												row.task_id === task.id &&
												row.state === "confirmed",
										);
										return (
											<section
												key={String(record.id)}
												aria-label="Launch recovery"
												className="mt-3 text-sm"
											>
												<p>
													Original launch outcome: {String(record.state)}.{" "}
													{String(decode<any>(record.payload, {}).detail ?? "")}
												</p>
												{recovered ? (
													<p>Ready to launch Rhino again.</p>
												) : supported ? (
													<Recovery
														launch
														recover={(acknowledgement) =>
															send({
																type: "recover_launch",
																requestId: crypto.randomUUID(),
																conversationId,
																taskId: String(task.id),
																launchRequestId: String(record.id),
																acknowledgement,
															})
														}
													/>
												) : (
													<p>
														Inspect the original Rhino process and its
														documents. Automatic launch recovery is unavailable
														for this launch.
													</p>
												)}
											</section>
										);
									})}
								{task.state === "uncertain" && (
									<p className="text-sm mt-3">
										The operation or cleanup outcome is unknown. Inspect Rhino
										before starting recovery. This task will not be replayed.
									</p>
								)}
								{task.state === "uncertain" &&
									!snapshot!.recoveries?.some(
										(record) => record.task_id === task.id,
									) && (
										<Recovery
											recover={(acknowledgement) =>
												send({
													type: "recover",
													requestId: crypto.randomUUID(),
													conversationId,
													taskId: String(task.id),
													acknowledgement,
												})
											}
										/>
									)}
								{snapshot!.recoveries?.some(
									(record) => record.task_id === task.id,
								) && (
									<p className="text-xs mt-2">
										Unknown outcome acknowledged. Submit a fresh task against
										the inspected state.
									</p>
								)}
							</article>
						);
						return task.parent_task_id ? (
							<details
								key={String(task.id)}
								className="ml-6 border rounded-lg p-3"
							>
								<summary className="cursor-pointer text-sm">
									{input.bindings.map(bindingLabel).join(", ") || "Rhino work"}
									{task.state === "running"
										? <>{ " · " }<TaskWorkingTime task={task} turns={snapshot?.turns ?? []} inline /></>
										: task.state === "failed"
											? " · Failed"
											: ""}
								</summary>
								{content}
							</details>
						) : (
							content
						);
					})}
						</div>
						{showJump && (
							<Button
								size="sm"
								variant="secondary"
								className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop animate-pop-in"
								onClick={() => { stickToBottom.current = true; scrollToLatest(); }}
							>
								Jump to latest
							</Button>
						)}
					</div>
					<div className="max-h-[70dvh] overflow-y-auto border-t px-4 pt-3 pb-2 space-y-3 sm:px-6">
						<Composer
							key={conversationId}
							ref={composer}
						draft={text}
						images={images}
						onImagesChange={setImages}
						imagesSupported={imagesSupported}
						onDraftChange={setText}
						mode={sendMode}
						onModeChange={setSendMode}
							disabled={
								!sessionId ||
								!ready.current ||
								submitting ||
								taskBlocksComposer
						}
						submitDisabled={sendMode !== "steer" && (unavailableSelected || !selected.length)}
						destination={
							<div className="flex min-w-0 flex-wrap items-center gap-2">
								<Select
									value={selected[0] ? JSON.stringify(selected[0]) : ""}
									onValueChange={(value) => {
										const binding = modelBindings.find((binding) => JSON.stringify(binding) === value);
										if (binding) setSelected([binding]);
									}}
									disabled={!ready.current || sendMode === "steer" || !modelBindings.length}
								>
									<SelectTrigger aria-label="Rhino model" className={toolbarTriggerClass + " max-w-full"}>
										<Box className="size-3.5 shrink-0" />
										<SelectValue placeholder="No Rhino models connected">
											<span aria-label="Message destination" className="block truncate">
												{sendMode === "steer" ? `Steering: ${steeringDestination}` : selected[0] ? bindingLabel(selected[0]) : "No Rhino models connected"}
											</span>
										</SelectValue>
									</SelectTrigger>
									<SelectContent align="start" side="top" className="max-w-[calc(100vw-2rem)]">
										{modelBindings.map((binding) => (
											<SelectItem key={JSON.stringify(binding)} value={JSON.stringify(binding)}>{bindingLabel(binding)}</SelectItem>
										))}
									</SelectContent>
								</Select>
								{unavailableSelected && sendMode !== "steer" && <span role="alert" className="text-xs text-danger">Selected model disconnected. Choose another model.</span>}
							</div>
						}
							streaming={taskIsRunning}
						onSubmit={submit}
						onAbort={() => {
							if (activeRoot)
								send({
									type: "cancel",
									requestId: crypto.randomUUID(),
									conversationId,
									taskId: String(activeRoot.id),
								});
						}}
						controls={
							<ModelControls
								connected={ready.current}
								onSelectModel={(value) => {
									const [provider, ...id] = value.split("/");
									send({ type: "set_model", provider, modelId: id.join("/") });
								}}
								onSelectThinking={(level) =>
									send({ type: "set_thinking", level })
								}
								onManageProvider={() => { setMobileSettingsOpen(false); setProviderOpen(true); }}
							/>
						}
					/>
				</div>
			</main>
			{providerOpen && (
				<ProviderDialog
					onOpenChange={setProviderOpen}
					onLogin={(provider, authType, apiKey) => {
						store.getState().actions.startAuth(provider, "Signing in");
						return send({
							type: "login",
							provider,
							authType,
							...(apiKey ? { apiKey } : {}),
						});
					}}
					onLogout={(provider) => {
						if (window.confirm(`Sign out of ${provider}?`))
							send({ type: "logout", provider });
					}}
				/>
			)}
			{skillsOpen && (
				<SkillsDialog
					token={credential.current ?? ""}
					connected={ready.current}
					streaming={!!activeRoot}
					onOpenChange={setSkillsOpen}
				/>
			)}
			{toolsOpen && (
				<ToolsDialog
					key={sessionId}
					token={credential.current ?? ""}
					connected={ready.current}
					onOpenChange={setToolsOpen}
				/>
			)}
			<ToastRegion />
			<UiRequestDialog
				send={(message) =>
					message.type === "ui_response" &&
					send({
						type: "auth_response",
						requestId: message.requestId,
						value: message.value,
					})
				}
			/>
		</div>
	);
}
function UserMessage({
	text,
	attachments,
	status,
}: {
	text: string;
	attachments?: unknown;
	status?: string;
}) {
	let images: ReturnType<typeof parseImages>;
	try {
		images = parseImages(attachments);
	} catch {
		images = [];
	}
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-2xl bg-panel px-4 py-3 space-y-2">
				{text && <p className="whitespace-pre-wrap break-words">{text}</p>}
				{images?.map((image, index) => (
					<img
						key={index}
						src={imageUrl(image)}
						alt="Attached image"
						className="max-h-72 max-w-full rounded-lg"
					/>
				))}
				{status && <p className="text-xs text-muted">{status}</p>}
			</div>
		</div>
	);
}

function Question({
	question,
	enabled,
	inactive,
	answer,
}: {
	question: Row;
	enabled: boolean;
	inactive?: boolean;
	answer: (value: string) => boolean;
}) {
	const [value, setValue] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const section = useRef<HTMLElement>(null);
	const payload = decode<{ question?: string; options?: string[] }>(
		question.payload,
		{},
	);
	if (question.answer !== null) {
		const response = decode<unknown>(question.answer, question.answer);
		return (
			<section className="mt-4 border rounded p-3 text-sm">
				<p>{payload.question ?? "Question"}</p>
				<p className="mt-2">
					Answer:{" "}
					{typeof response === "string" ? response : JSON.stringify(response)}
				</p>
			</section>
			);
	}
	const options = Array.isArray(payload.options) ? payload.options.filter(Boolean) : [];
	useEffect(() => {
		if (!enabled) return;
		section.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		if (!options.length) input.current?.focus();
	}, [enabled, options.length, question.id]);
	return (
		<section
			ref={section}
			aria-label="Input needed"
			className="mt-4 rounded-md border border-accent/30 bg-accent-soft p-4 shadow-card"
		>
			<form
			onSubmit={(event) => {
				event.preventDefault();
				if (answer(value)) setValue("");
			}}
		>
			<p className="text-[10px] font-medium uppercase tracking-wider text-accent">Input needed</p>
			<p className="mt-1 text-sm font-medium">{payload.question ?? "Answer needed"}</p>
			{!enabled && (
				<p className="mt-2 text-xs text-ink-soft" role="status">
					{inactive
						? "This question is no longer active."
						: "Finishing the current operation."}
				</p>
			)}
			{options.length > 0 ? (
				<div className="mt-3 grid gap-2" role="radiogroup" aria-label={payload.question ?? "Answer options"}>
					{options.map((option, index) => {
						const checked = value === option;
						return (
							<label key={option} className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-sm ${checked ? "border-accent bg-surface" : "border-line bg-surface hover:border-line-strong"}`}>
								<input className="sr-only" type="radio" name={`question-${question.id}`} value={option} checked={checked} disabled={!enabled} autoFocus={enabled && index === 0} onChange={(event) => setValue(event.target.value)} />
								<span aria-hidden="true" className={`grid size-4 place-items-center rounded-full border ${checked ? "border-accent bg-accent" : "border-line-strong"}`}><span className={checked ? "size-1.5 rounded-full bg-white" : ""} /></span>
								{option}
							</label>
						);
					})}
				</div>
			) : (
				<input ref={input} disabled={!enabled} aria-label="Answer" className="mt-3 h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-[13px] outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50" value={value} onChange={(event) => setValue(event.target.value)} />
			)}
			<div className="mt-3 flex justify-end">
				<Button type="submit" size="sm" disabled={!enabled || !value.trim()}>Continue</Button>
			</div>
			</form>
		</section>
	);
}

function Recovery({
	recover,
	launch = false,
}: {
	recover: (acknowledgement: string) => boolean;
	launch?: boolean;
}) {
	const [acknowledgement, setAcknowledgement] = useState("");
	return (
		<form
			className="mt-3 border p-3 rounded"
			onSubmit={(event) => {
				event.preventDefault();
				recover(acknowledgement);
			}}
		>
			<label className="text-xs block">
				{launch
					? "Preserve your models, inspect startup or autosave dialogs, and close all Rhino processes before recovery. Record what you checked. The host verifies that no Rhino process remains before allowing a new grant; it does not close Rhino for you."
					: "Record what you inspected in the affected Rhino documents and files. This acknowledges the unknown outcome; it does not undo or repeat the operation."}
				<textarea
					aria-label={
						launch ? "Launch recovery inspection" : "Recovery inspection"
					}
					className="block border bg-canvas p-2 mt-2 w-full"
					value={acknowledgement}
					onChange={(event) => setAcknowledgement(event.target.value)}
				/>
			</label>
			<button
				disabled={!acknowledgement.trim()}
				className="border rounded p-2 mt-2 text-sm"
			>
				{launch
					? "Acknowledge and verify launch recovery"
					: "Acknowledge and verify safe release"}
			</button>
		</form>
	);
}
