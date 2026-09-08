import { useEffect, useRef, useState } from "react";
import type {
	NextDocumentAction,
	SharedBrowserCommand,
} from "../../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../../src/protocol/shared-execution.js";
import type {
	HostSnapshot,
	UiRequestMessage,
} from "../../../src/host/protocol.js";
import { MessageMarkdown } from "../components/message-markdown";
import { Composer } from "../components/composer";
import { imageUrl, type DraftImage } from "../lib/image-attachments";
import { parseImages } from "../../../src/host/protocol";

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
		sessionStorage.setItem("hopper.sharedToken", raw);
		history.replaceState(null, "", location.pathname);
	}
	return raw || sessionStorage.getItem("hopper.sharedToken") || "";
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
		? (labels?.[binding.rhinoDocumentId] ??
				`Rhino document ${binding.rhinoDocumentId}`)
		: `${labels?.[binding.grasshopperDocumentId] ?? `Grasshopper ${binding.grasshopperDocumentId}`}${binding.associatedRhinoDocumentId ? ` / ${labels?.[binding.associatedRhinoDocumentId] ?? `Rhino ${binding.associatedRhinoDocumentId}`}` : ""}`;
}

export function SharedApp() {
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [conversationId, setConversationId] = useState("");
	const [selected, setSelected] = useState<TargetBinding[]>([]);
	const [text, setText] = useState("");
	const [images, setImages] = useState<DraftImage[]>([]);
	const currentConversation = useRef(conversationId);
	currentConversation.current = conversationId;
	const [sendMode, setSendMode] = useState<"prompt" | "follow_up" | "steer">(
		"prompt",
	);
	const [documentAction, setDocumentAction] = useState<NextDocumentAction>();
	const [launch, setLaunch] = useState<{
		installationId: string;
		independentProcess: boolean;
	}>();
	const [status, setStatus] = useState("Connecting");
	const [error, setError] = useState("");
	const [nonce, setNonce] = useState(0);
	const [authPrompt, setAuthPrompt] = useState<UiRequestMessage>();
	const [authValue, setAuthValue] = useState("");
	const socket = useRef<WebSocket | undefined>(undefined);
	const credential = useRef<string>(undefined);
	const ready = useRef(false);
	const pending = useRef(new Map<string, SharedBrowserCommand>());
	const [, refreshPending] = useState(0);
	const blocked = useRef(false);
	useEffect(() => {
		if (credential.current === undefined) credential.current = token();
		if (!credential.current) {
			setStatus("Open the shared Hopper link from Rhino to authenticate.");
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
				setStatus("Connected");
				setConversationId(
					(current) =>
						current || String(message.snapshot.conversations[0]?.id ?? ""),
				);
				if (!ready.current) {
					ready.current = true;
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
					if (accepted.type === "submit") {
						setDocumentAction((current) =>
							JSON.stringify(current) ===
							JSON.stringify(accepted.documentAction)
								? undefined
								: current,
						);
						setLaunch((current) =>
							JSON.stringify(current) === JSON.stringify(accepted.launch)
								? undefined
								: current,
						);
					}
					if (message.result?.admissionError)
						setError(message.result.admissionError);
				}
				if (accepted?.type === "create_conversation") {
					setConversationId(message.result.conversationId);
					setSelected([]);
					setText("");
					setImages([]);
					setDocumentAction(undefined);
					setLaunch(undefined);
				}
			} else if (message.type === "error") {
				pending.current.delete(message.requestId);
				refreshPending((value) => value + 1);
				setError(message.message);
			} else if (message.type === "ui_request") {
				setAuthPrompt(message);
				setAuthValue("");
			} else if (message.type === "auth_event")
				setStatus(
					String(message.event?.message ?? "Waiting for provider sign-in"),
				);
		};
		ws.onclose = (event) => {
			ready.current = false;
			if (disposed) return;
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
	const submit = () => {
		if (
			(!text.trim() && !images.length) ||
			!sessionId ||
			(images.length && !imagesSupported)
		)
			return;
		if (
			sendMode !== "steer" &&
			documentAction?.action === "open" &&
			!documentAction.path?.trim()
		) {
			setError("Enter the full path of the document to open.");
			return;
		}
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
			...(documentAction ? { documentAction } : {}),
			...(launch ? { launch } : {}),
		});
	};
	return (
		<main className="h-screen flex bg-background text-foreground">
			<aside className="w-64 border-r p-4 overflow-auto space-y-4">
				<h1 className="text-lg font-semibold">Hopper</h1>
				<p className="text-xs text-muted-foreground">Shared host</p>
				<button
					className="border rounded px-3 py-2 w-full"
					onClick={() =>
						send({
							type: "create_conversation",
							requestId: crypto.randomUUID(),
							title: `Conversation ${(snapshot?.conversations.length ?? 0) + 1}`,
						})
					}
				>
					New conversation
				</button>
				{snapshot?.conversations.map((conversation) => (
					<button
						key={String(conversation.id)}
						className={`block w-full text-left rounded p-2 ${conversation.id === conversationId ? "bg-muted" : ""}`}
						onClick={() => {
							setConversationId(String(conversation.id));
							setSelected([]);
							setText("");
							setImages([]);
							setDocumentAction(undefined);
							setLaunch(undefined);
						}}
					>
						{String(conversation.title ?? "Conversation")}
					</button>
				))}
				<p className="text-xs">{status}</p>
				<button
					className="text-sm underline"
					onClick={() => {
						blocked.current = false;
						setNonce((n) => n + 1);
					}}
				>
					Reconnect
				</button>
				<details>
					<summary>Model and sign-in</summary>
					<select
						aria-label="Model"
						className="w-full border my-2 bg-background"
						value={
							snapshot?.runtime.model
								? `${snapshot.runtime.model.provider}/${snapshot.runtime.model.id}`
								: ""
						}
						onChange={(event) => {
							const model = snapshot?.runtime.models.find(
								(model) =>
									`${model.provider}/${model.id}` === event.target.value,
							);
							if (model)
								send({
									type: "set_model",
									provider: model.provider,
									modelId: model.id,
								});
						}}
					>
						<option value="">Select a model</option>
						{snapshot?.runtime.models.map((model) => (
							<option
								key={`${model.provider}/${model.id}`}
								value={`${model.provider}/${model.id}`}
							>
								{model.name ?? model.id}
							</option>
						))}
					</select>
					{snapshot?.runtime.providers.map((provider) => (
						<div key={provider.id} className="my-2 text-sm">
							{provider.name}{" "}
							{provider.authenticated
								? "✓"
								: provider.authMethods.map((method) => (
										<button
											className="block underline"
											key={method.type}
											onClick={() =>
												send({
													type: "login",
													provider: provider.id,
													authType: method.type,
												})
											}
										>
											{method.label}
										</button>
									))}
						</div>
					))}
				</details>
				<details>
					<summary>Host controls</summary>
					<p className="text-xs my-2">
						Stop cancels pending work and keeps Rhino documents open.
					</p>
					<button
						className="border rounded px-2 py-1"
						onClick={() =>
							send({
								type: "stop_host",
								requestId: crypto.randomUUID(),
								hostEpoch: snapshot!.hostEpoch,
							})
						}
					>
						Stop host
					</button>
				</details>
			</aside>
			<section className="flex-1 flex flex-col min-w-0">
				<header className="border-b p-4">
					<h2 className="font-medium">
						{String(
							snapshot?.conversations.find((c) => c.id === conversationId)
								?.title ?? "Create a conversation to begin",
						)}
					</h2>
					{error && (
						<p role="alert" className="text-red-500 mt-2">
							{error}
						</p>
					)}
				</header>
				<div className="flex-1 overflow-auto p-5 space-y-5">
					{orderedTasks.map((task) => {
						const input = decode<{ text: string; bindings: TargetBinding[] }>(
							task.payload,
							{ text: "", bindings: [] },
						);
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
						const usage = snapshot!.turns
							.filter((turn) => turn.task_id === task.id)
							.reduce((total, turn) => total + Number(turn.usage ?? 0), 0);
						const artifacts = (snapshot!.records ?? []).filter(
							(record) =>
								record.task_id === task.id &&
								(record.kind === "artifact" || record.kind === "transfer"),
						);
						const content = (
							<article
								key={String(task.id)}
								className={`border rounded-lg p-4 ${task.parent_task_id ? "mt-3" : ""}`}
							>
								<div className="flex justify-between gap-4">
									<p className="whitespace-pre-wrap">{input.text}</p>
									<span className="text-xs shrink-0">
										{String(task.state)} · {usage.toLocaleString()} tokens
									</span>
								</div>
								{progressLabel &&
									["running", "suspending"].includes(String(task.state)) && (
										<p role="status" className="text-xs mt-2">
											{progressLabel}
										</p>
									)}
								{input.bindings?.map((binding) => (
									<p
										key={JSON.stringify(binding)}
										className="text-xs text-muted-foreground mt-2"
									>
										{targetName(
											binding,
											snapshot?.targets.find(
												(target) =>
													target.lifecycleInstanceId ===
													binding.lifecycleInstanceId,
											)?.documentLabels,
										)}
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
															{message.toolName ?? "Rhino"} ·{" "}
															{message.toolCallId ?? "capture"}
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
										Cancel task
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
													<p>
														Launch recovery confirmed. A fresh launch requires a
														new grant; the original outcome is unchanged.
													</p>
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
								{artifacts.length > 0 && (
									<section
										aria-label="Geometry artifacts and imports"
										className="mt-3 space-y-2"
									>
										{artifacts.map((record) => {
											const payload = decode<any>(record.payload, {}),
												artifact =
													record.kind === "artifact"
														? payload
														: payload.artifact;
											return (
												<details
													key={`${record.kind}:${record.id}`}
													className="border rounded p-2 text-xs"
												>
													<summary>
														{record.kind === "artifact"
															? "Geometry artifact"
															: "Geometry import"}{" "}
														· {String(record.state)}
														{artifact?.format ? ` · .${artifact.format}` : ""}
													</summary>
													{artifact?.units && (
														<p className="mt-2">
															{artifact.units} ·{" "}
															{artifact.objectIds?.length ?? 0} source objects
														</p>
													)}
													{record.kind === "transfer" && payload.objectIds && (
														<p className="mt-2">
															{payload.objectIds.length} new destination objects
														</p>
													)}
													{artifact?.path && (
														<p className="mt-2 break-all">
															Retained file: <code>{artifact.path}</code>
														</p>
													)}
													{artifact?.checksum && (
														<p className="mt-2 break-all">
															SHA-256: <code>{artifact.checksum}</code>
														</p>
													)}
													<pre className="mt-2 whitespace-pre-wrap overflow-auto">
														{JSON.stringify(payload, null, 2)}
													</pre>
												</details>
											);
										})}
									</section>
								)}
								<details className="mt-3 text-xs">
									<summary>Task history</summary>
									<pre className="overflow-auto whitespace-pre-wrap">
										{JSON.stringify(
											snapshot!.events
												.filter((event) => event.task_id === task.id)
												.map((event) => ({
													...event,
													payload: decode(event.payload, event.payload),
												})),
											null,
											2,
										)}
									</pre>
								</details>
							</article>
						);
						return task.parent_task_id ? (
							<details
								key={String(task.id)}
								className="ml-6 border rounded-lg p-3"
							>
								<summary className="cursor-pointer text-sm">
									Child task ·{" "}
									{input.bindings
										.map((binding) =>
											targetName(
												binding,
												snapshot?.targets.find(
													(target) =>
														target.lifecycleInstanceId ===
														binding.lifecycleInstanceId,
												)?.documentLabels,
											),
										)
										.join(", ")}{" "}
									· {String(task.state)} · {usage.toLocaleString()} tokens
									{artifacts.length
										? ` · ${artifacts.length} artifact/import records`
										: ""}
									{progressLabel && task.state === "running"
										? ` · ${progressLabel}`
										: ""}
								</summary>
								{content}
							</details>
						) : (
							content
						);
					})}
				</div>
				<div className="border-t p-4 space-y-3">
					<details>
						<summary className="text-sm">
							Targets for the next submission ·{" "}
							{selected.length || "discussion only"}
						</summary>
						{selected.length > 0 && (
							<button
								className="text-xs underline my-2"
								onClick={() => setSelected([])}
							>
								Clear selected targets
							</button>
						)}
						{!snapshot?.targets.length && (
							<p className="text-sm my-2">
								No Rhino is attached. Discussion is available.
							</p>
						)}
						{snapshot?.targets.map((target) => (
							<fieldset key={target.lifecycleInstanceId} className="mt-2">
								<legend className="text-sm">
									{target.label} · {target.admission}
								</legend>
								<button
									disabled={target.admission !== "ready"}
									className="text-xs underline my-1"
									onClick={() => {
										setDocumentAction({
											lifecycleInstanceId: target.lifecycleInstanceId,
											kind: "rhino",
											action: "new",
											modifiedPolicy: "refuse",
										});
										setLaunch(undefined);
									}}
								>
									New Rhino document
								</button>
								<button
									disabled={target.admission !== "ready"}
									className="text-xs underline ml-3 my-1"
									onClick={() => {
										setDocumentAction({
											lifecycleInstanceId: target.lifecycleInstanceId,
											kind: "rhino",
											action: "open",
											modifiedPolicy: "refuse",
										});
										setLaunch(undefined);
									}}
								>
									Open Rhino document
								</button>
								{target.documents.map((binding) => (
									<label
										key={JSON.stringify(binding)}
										className="flex gap-2 text-sm my-1"
									>
										<input
											type="checkbox"
											disabled={target.admission !== "ready"}
											checked={selected.some(
												(item) =>
													JSON.stringify(item) === JSON.stringify(binding),
											)}
											onChange={(event) =>
												setSelected((old) =>
													event.target.checked
														? [...old, binding]
														: old.filter(
																(item) =>
																	JSON.stringify(item) !==
																	JSON.stringify(binding),
															),
												)
											}
										/>
										{targetName(binding, target.documentLabels)}
									</label>
								))}
								{target.documents.length > 1 && (
									<p className="text-xs text-muted-foreground">
										Edits run sequentially in this Rhino process.
									</p>
								)}
							</fieldset>
						))}
					</details>
					{snapshot?.installations?.map((installation) => (
						<button
							key={installation.id}
							disabled={!installation.bootstrapVerified}
							title={installation.unavailableReason}
							className="text-xs underline mr-3 disabled:opacity-40"
							onClick={() => {
								setLaunch({
									installationId: installation.id,
									independentProcess: snapshot.targets.some(
										(target) => target.admission !== "detached",
									),
								});
								setDocumentAction(undefined);
								setSelected([]);
							}}
						>
							Authorize one Rhino launch · {installation.id}
						</button>
					))}
					{documentAction && (
						<DocumentActionControls
							action={documentAction}
							update={setDocumentAction}
							remove={() => setDocumentAction(undefined)}
						/>
					)}
					{launch && (
						<p className="text-xs">
							Next task may launch one Rhino process.{" "}
							<button
								className="underline"
								onClick={() => setLaunch(undefined)}
							>
								Remove
							</button>
						</p>
					)}
					<Composer
						key={conversationId}
						draft={text}
						images={images}
						onImagesChange={setImages}
						imagesSupported={imagesSupported}
						onDraftChange={setText}
						mode={sendMode}
						onModeChange={setSendMode}
						disabled={!conversationId || !ready.current || submitting}
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
							<select
								aria-label="Send mode"
								className="border rounded p-2 bg-background mr-2 text-xs"
								value={sendMode}
								onChange={(event) =>
									setSendMode(event.target.value as typeof sendMode)
								}
							>
								<option value="prompt">New task</option>
								<option value="follow_up">Queue follow-up</option>
								<option value="steer">Steer active turn</option>
							</select>
						}
					/>
				</div>
			</section>
			{authPrompt && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center">
					<form
						className="bg-background p-6 rounded border max-w-lg w-full"
						onSubmit={(event) => {
							event.preventDefault();
							if (
								send({
									type: "auth_response",
									requestId: authPrompt.requestId,
									value: authValue,
								})
							) {
								setAuthPrompt(undefined);
								setAuthValue("");
							}
						}}
					>
						<h2>{authPrompt.title}</h2>
						<p className="text-sm my-3">{authPrompt.description}</p>
						<input
							autoFocus
							aria-label="Sign-in response"
							type={authPrompt.secret ? "password" : "text"}
							value={authValue}
							onChange={(event) => setAuthValue(event.target.value)}
							className="border p-2 w-full bg-background"
						/>
						<button className="border rounded p-2 mt-3">Continue</button>
					</form>
				</div>
			)}
		</main>
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
						: "Waiting for operations and scope cleanup."}
				</p>
			)}
			<input
				disabled={!enabled}
				aria-label="Answer"
				className="border p-2 mt-2 bg-background"
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
					className="block border bg-background p-2 mt-2 w-full"
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

function DocumentActionControls({
	action,
	update,
	remove,
}: {
	action: NextDocumentAction;
	update: (action: NextDocumentAction) => void;
	remove: () => void;
}) {
	const changePolicy = (
		modifiedPolicy: NextDocumentAction["modifiedPolicy"],
	) => {
		const { savePath: _savePath, overwrite: _overwrite, ...base } = action;
		update({ ...base, modifiedPolicy });
	};
	return (
		<fieldset className="border rounded p-3 space-y-2 text-sm">
			<legend className="px-1">
				One {action.action === "new" ? "new" : "open"} document action for the
				next task
			</legend>
			<label className="block">
				Document kind
				<select
					aria-label="Document action kind"
					className="block border rounded bg-background p-2 mt-1"
					value={action.kind}
					onChange={(event) =>
						update({
							lifecycleInstanceId: action.lifecycleInstanceId,
							action: action.action,
							kind: event.target.value as NextDocumentAction["kind"],
							modifiedPolicy: "refuse",
						})
					}
				>
					<option value="rhino">Rhino model</option>
					<option value="grasshopper">Grasshopper canvas</option>
				</select>
			</label>
			{action.action === "open" && (
				<label className="block">
					Full path to open
					<input
						aria-label="Document path to open"
						className="block w-full border rounded bg-background p-2 mt-1"
						value={action.path ?? ""}
						onChange={(event) =>
							update({ ...action, path: event.target.value })
						}
						placeholder={
							action.kind === "rhino"
								? "Full path to a .3dm file"
								: "Full path to a .gh or .ghx file"
						}
					/>
				</label>
			)}
			<label className="block">
				If this action replaces a modified document
				<select
					aria-label="Modified document policy"
					className="block border rounded bg-background p-2 mt-1"
					value={action.modifiedPolicy}
					onChange={(event) =>
						changePolicy(
							event.target.value as NextDocumentAction["modifiedPolicy"],
						)
					}
				>
					<option value="refuse">Keep changes and stop the action</option>
					<option value="save">Save changes before replacement</option>
					<option value="discard">
						Discard unsaved changes before replacement
					</option>
				</select>
			</label>
			<p className="text-xs text-muted-foreground">
				Rhino on Mac adds a document in the same process. Existing documents
				stay open and edits run sequentially.
			</p>
			{action.modifiedPolicy === "save" && (
				<>
					<label className="block">
						Save path
						<input
							aria-label="Replacement save path"
							className="block w-full border rounded bg-background p-2 mt-1"
							value={action.savePath ?? ""}
							onChange={(event) => {
								const { savePath: _old, ...base } = action;
								update(
									event.target.value
										? { ...base, savePath: event.target.value }
										: base,
								);
							}}
							placeholder="Leave blank to use the document's existing path"
						/>
					</label>
					<p className="text-xs text-muted-foreground">
						An unnamed document needs a full save path.
					</p>
					<label className="flex gap-2 items-center">
						<input
							type="checkbox"
							aria-label="Allow overwriting the save destination"
							checked={action.overwrite === true}
							onChange={(event) => {
								const { overwrite: _old, ...base } = action;
								update(
									event.target.checked ? { ...base, overwrite: true } : base,
								);
							}}
						/>
						Allow overwriting an existing file at this save path
					</label>
				</>
			)}
			{action.modifiedPolicy === "discard" && (
				<p className="text-xs">
					This explicitly authorizes losing unsaved changes in the document this
					action replaces.
				</p>
			)}
			<button className="text-xs underline" onClick={remove}>
				Remove document action
			</button>
		</fieldset>
	);
}
