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
import { useEffect, useRef, useState } from "react";
import type { SharedBrowserCommand } from "../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../src/protocol/shared-execution.js";
import type { HostSnapshot } from "../../src/host/protocol.js";
import { MessageMarkdown } from "./components/message-markdown";
import { WorkingTime } from "./components/working-time";
import { Composer } from "./components/composer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { imageUrl, type DraftImage } from "./lib/image-attachments";
import { parseImages } from "../../src/host/protocol";

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
 const streaming = task.state === "running" || task.state === "suspending";
 const finishedAt = streaming ? undefined : Number(task.updated_at) || undefined;
 return <WorkingTime streaming={streaming} startedAt={startedAt} finishedAt={finishedAt} inline={inline} />;
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
		(task) => task.parent_task_id === null && task.state === "running",
	);
	const sendMode = modeOverride ?? (activeRoot ? "follow_up" : "prompt");
	useEffect(() => {
		if (!activeRoot) setSendMode(null);
	}, [activeRoot?.id]);
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
				onManageProvider={() => setProviderOpen(true)}
				onManageSkills={() => setSkillsOpen(true)}
				onViewTools={() => setToolsOpen(true)}
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
						<h2 className="flex-1 truncate text-[13px] font-medium">
							{String(
								snapshot?.conversations.find((c) => c.id === conversationId)
									?.title ?? "New chat",
							)}
						</h2>
						<ExportSessionButton
							token={credential.current ?? ""}
							conversationId={conversationId}
							disabled={!ready.current || !conversationId}
						/>
						<Badge
							dot
							variant={
								ready.current ? (activeRoot ? "accent" : "neutral") : "warn"
							}
						>
							{ready.current ? (activeRoot ? <TaskWorkingTime task={activeRoot} turns={snapshot?.turns ?? []} inline /> : "Ready") : status}
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
				<div className="flex-1 overflow-auto px-5 py-8 space-y-8">
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
								{messages
									.filter((message: any) => message.role === "assistant")
									.map((message: any, i: number) => (
										<div key={i} className="mt-3">
											{message.content
												.filter((part: any) => part.type === "text")
												.map((part: any, j: number) => (
													<MessageMarkdown key={j} text={part.text} />
												))}
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
				<div className="max-h-[70dvh] overflow-y-auto border-t px-4 pt-3 pb-2 space-y-3 sm:px-6">
					<Composer
						key={conversationId}
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
							submitting
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
						streaming={!!activeRoot}
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
								onManageProvider={() => setProviderOpen(true)}
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
				{text && <p className="whitespace-pre-wrap">{text}</p>}
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
	return (
		<form
			className="mt-4 border rounded p-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (answer(value)) setValue("");
			}}
		>
			<p>{payload.question ?? "Answer needed"}</p>
			{!enabled && (
				<p className="text-xs">
					{inactive
						? "This question is no longer active."
						: "Finishing the current operation."}
				</p>
			)}
			<input
				disabled={!enabled}
				aria-label="Answer"
				className="border p-2 mt-2 bg-canvas"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				list={String(question.id)}
			/>
			<datalist id={String(question.id)}>
				{payload.options?.map((option) => (
					<option key={option} value={option} />
				))}
			</datalist>
			<button disabled={!enabled || !value.trim()} className="border p-2 ml-2">
				Answer
			</button>
		</form>
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
