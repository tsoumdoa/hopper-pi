import { ArrowDown, Box, ChevronRight, CircleAlert, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parseImages, type ImageAttachment } from "../../../src/host/protocol";
import type { TargetBinding } from "../../../src/protocol/shared-execution.js";
import { ImageGallery } from "./image-gallery";
import { cn } from "../lib/utils";
import type { SendMode } from "../state/hopper-types";
import { decode, type Row, type SharedSnapshot } from "../state/shared-snapshot";
import { taskTools } from "../state/task-tools";
import { RequestDialog } from "./ui-request-dialog";
import type { UiRequest } from "../state/hopper-types";
import { OTHER_OPTION_LABEL, formatPickOptionLabels, type PickOption } from "../../../src/types/choices";
import { ThinkingBlock, ToolHistory, Welcome } from "./conversation";
import { MessageMarkdown } from "./message-markdown";
import { Button } from "./ui/button";
import { WorkingTime } from "./working-time";

const KIND_LABELS: Partial<Record<SendMode, string>> = { steer: "Steering note", follow_up: "Follow-up" };
const SETTLED_STATES = ["completed", "cancelled", "failed", "interrupted", "uncertain"];

type TaskInput = { text: string; bindings: TargetBinding[]; messageTarget?: TargetBinding; attachments?: unknown; kind?: SendMode };
type LiveAssistantMessage = { id: string; turnId: string; text: string; thinking: string; streaming: boolean };

/** Elapsed time for a task, taken from its saved turn timestamps so reconnects keep the clock. */
export function TaskWorkingTime({ task, turns, inline = false }: { task: Row; turns: Row[]; inline?: boolean }) {
	const timestamps = turns
		.filter((turn) => turn.task_id === task.id)
		.map((turn) => Number(turn.started_at))
		.filter((time) => Number.isFinite(time) && time > 0);
	const startedAt = timestamps.length ? Math.min(...timestamps) : Number(task.created_at) || undefined;
	const streaming = task.state === "running" || task.state === "suspending";
	const finishedAt = streaming ? undefined : Number(task.updated_at) || undefined;
	return <WorkingTime streaming={streaming} startedAt={startedAt} finishedAt={finishedAt} inline={inline} />;
}

/** Assistant text that is still streaming: agent events for turns without a saved message list yet. */
function liveAssistantMessages(events: Row[], completedTurns: Set<string>): LiveAssistantMessage[] {
	const messages: LiveAssistantMessage[] = [];
	const current = new Map<string, LiveAssistantMessage>();
	for (const row of events) {
		const payload = decode<any>(row.payload, {});
		if (payload.type === "assistant_message") {
			const content = (payload.message?.content ?? []).filter(Boolean);
			messages.push({ id: payload.messageId, turnId: String(payload.turnId), streaming: Boolean(payload.streaming),
				text: content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n"),
				thinking: content.filter((part: any) => part.type === "thinking").map((part: any) => part.thinking ?? part.text).join("\n") });
			continue;
		}
		if (payload.type !== "agent_event" || !payload.turnId) continue;
		const event = payload.event ?? {};
		const turnId = String(payload.turnId);
		if (event.type === "message_start") {
			if (event.message?.role === "assistant") {
				const previous = current.get(turnId);
				if (previous) previous.streaming = false;
				const message = { id: `${turnId}:${messages.length}`, turnId, text: "", thinking: "", streaming: true };
				messages.push(message);
				current.set(turnId, message);
			}
			continue;
		}
		const message = current.get(turnId);
		if (!message) continue;
		if (event.type === "message_update") {
			const update = event.assistantMessageEvent ?? {};
			if (update.type === "text_delta") message.text += String(update.delta ?? update.text ?? "");
			if (update.type === "thinking_delta") message.thinking += String(update.delta ?? update.text ?? "");
			continue;
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			message.streaming = false;
			const content = Array.isArray(event.message.content) ? event.message.content : [];
			const text = content.filter((part: any) => part.type === "text").map((part: any) => String(part.text ?? "")).join("\n");
			const thinking = content.filter((part: any) => part.type === "thinking").map((part: any) => String(part.thinking ?? part.text ?? "")).join("\n");
			if (text) message.text = text;
			if (thinking) message.thinking = thinking;
		}
	}
	return messages.filter((message) => !completedTurns.has(message.turnId) && (message.streaming || message.text || message.thinking));
}

function safeImages(attachments: unknown): ImageAttachment[] {
	try {
		return parseImages(attachments) ?? [];
	} catch {
		return [];
	}
}

function UserBubble({ text, attachments, kind, status }: { text: string; attachments?: unknown; kind?: SendMode; status?: string }) {
	const label = kind ? KIND_LABELS[kind] : undefined;
	const images = safeImages(attachments);
	return (
		<div className="flex justify-end animate-slide-up" aria-label="Your message">
			<div className="min-w-0 max-w-[min(85%,560px)]">
				{label && <p className="mb-1 text-right text-[11px] font-medium text-muted">{label}</p>}
				<div className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-3.5 py-2 text-[14px] leading-6 text-ink">
					{text}
					{images.length > 0 && <div className={cn("min-w-0", text && "mt-2")}><ImageGallery images={images.map((image, index) => ({ image, label: `Attachment ${index + 1}` }))} /></div>}
				</div>
				{status && <p className="mt-1 text-right text-[11px] text-muted" role="status">{status}</p>}
			</div>
		</div>
	);
}

function Notice({ tone, children }: { tone: "danger" | "warn" | "muted"; children: ReactNode }) {
	if (tone === "muted") return <p className="text-[13px] text-muted" role="status">{children}</p>;
	return (
		<p
			role={tone === "danger" ? "alert" : "status"}
			className={cn(
				"flex items-start gap-2 rounded-sm border px-3 py-2 text-[13px] leading-5",
				tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-warn/30 bg-warn-soft text-warn",
			)}
		>
			<CircleAlert className="mt-0.5 size-4 shrink-0" />
			<span>{children}</span>
		</p>
	);
}

function Question({ question, enabled, inactive, waiting, target, queued = 0, answer }: {
	question: Row;
	enabled: boolean;
	inactive?: boolean;
	waiting?: boolean;
	target?: string;
	queued?: number;
	answer(value: string | null): boolean;
}) {
	const [other, setOther] = useState(false);
	const payload = useMemo(() => decode<{ kind?: string; question?: string; placeholder?: string; options?: (string | PickOption)[] }>(question.payload, {}), [question.payload]);
	const prompt = payload.question ?? "Answer needed";
	const request = useMemo<UiRequest>(() => {
		const options = (payload.options ?? []).map((option) => typeof option === "string"
			? { label: option, value: option }
			: { ...option, value: formatPickOptionLabels([option])[0]! });
		if (payload.kind === "pick_option") options.push({ label: OTHER_OPTION_LABEL, value: OTHER_OPTION_LABEL });
		return {
			type: "ui_request", requestId: String(question.id),
			kind: other || !options.length ? "input" : "select",
			title: other ? "Please specify:" : prompt,
			description: target,
			placeholder: other ? prompt : payload.placeholder,
			...(other ? {} : { options: options.map((option, index) => ({ ...option, id: String(index) })) }),
		};
	}, [question.id, payload, prompt, other, target]);
	if (question.answer !== null) {
		const response = decode<unknown>(question.answer, question.answer);
		return (
			<section aria-label="Answered question" className="rounded-md border border-line bg-surface p-3 text-[13px]">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted">Input needed</p>
				<p className="mt-1 font-medium text-ink">{prompt}</p>
				<p className="mt-1 text-ink-soft">{response === null ? "User cancelled" : `Answer: ${typeof response === "string" ? response : JSON.stringify(response)}`}</p>
			</section>
		);
	}
	if (!enabled) return <p role="status" className="text-xs text-muted">{inactive ? "This question is no longer active." : waiting ? "Waiting for your answer." : "Finishing the current operation."}</p>;
	return <RequestDialog key={other ? "other" : "choice"} request={request} queued={queued} respond={(value) => {
		if (!other && payload.kind === "pick_option" && value === OTHER_OPTION_LABEL) { setOther(true); return true; }
		const sent = answer(typeof value === "string" ? other ? `Other: ${value.trim()}` : value.trim() : null);
		return sent;
	}} />;
}

export type TaskThreadCommands = {
	enabled?: boolean;
	recoveryEnabled: boolean;
	answer(questionId: string, answer: string | null): boolean;
	recover(taskId: string, acknowledgement: string): boolean;
};

function TaskReply({ task, snapshot, labelFor, commands }: {
	task: Row;
	snapshot: SharedSnapshot;
	labelFor(binding: TargetBinding): string;
	commands: TaskThreadCommands;
}) {
	const state = String(task.state);
	const input = decode<TaskInput>(task.payload, { text: "", bindings: [] });
	const { messages, liveMessages, tools } = useMemo(() => {
		const events = snapshot.events.filter((event) => event.task_id === task.id && event.kind === "progress");
		const turnMessages = new Map<string, any[]>();
		for (const event of events) {
			const payload = decode<any>(event.payload, {});
			if (payload.type === "messages") turnMessages.set(String(payload.turnId), payload.messages ?? []);
		}
		const messages = [...turnMessages.values()].flat();
		const liveMessages = liveAssistantMessages(events, new Set(turnMessages.keys()));
		const tools = taskTools(events);
		return { messages, liveMessages, tools };
	}, [snapshot.events, task.id]);
	const running = state === "running" || state === "suspending";
	const questions = snapshot.questions.filter((question) => question.task_id === task.id);
	const recovered = snapshot.recoveries?.some((record) => record.task_id === task.id) ?? false;
	const captures = useMemo(() => messages
		.filter((message) => message.role === "toolResult" && Array.isArray(message.content))
		.flatMap((message, i) =>
			message.content
				.filter((part: any) => part.type === "image")
				.map((part: any, j: number) => ({ key: `capture-${i}-${j}`, image: safeImages([part])[0], tool: String(message.toolName ?? "Rhino") }))
				.filter((capture: { image?: ImageAttachment }) => capture.image),
		), [messages]);
	const assistantMessages = messages.filter((message: any) => message.role === "assistant");
	const idle = running && !assistantMessages.length && !liveMessages.length && !tools.length;
	const targets = (input.messageTarget ? [input.messageTarget] : input.bindings)?.map(labelFor) ?? [];
	const block = (snapshot.records ?? []).find((record) =>
		record.kind === "scheduling" && record.task_id === task.id && record.state === "blocked");
	const reason = block ? decode<{ reason?: string }>(block.payload, {}).reason : undefined;

	if (state === "queued") {
		return (
			<div className="flex items-center justify-between gap-3 text-[13px] text-muted" aria-label="Hopper's reply">
				<p role="status" className="flex items-center gap-2">
					<Loader2 className="size-3.5 animate-spin" />
					{reason || "Waiting to start…"}
				</p>
			</div>
		);
	}

	return (
		<div className="min-w-0 animate-slide-up" aria-label="Hopper's reply">
			<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 pb-3 text-[13px] text-muted">
				{state === "awaiting_user" ? <span role="status">Waiting for your answer</span> : <TaskWorkingTime task={task} turns={snapshot.turns} inline />}
				{targets.map((target) => (
					<span key={target} className="inline-flex min-w-0 items-center gap-1 text-[11px]">
						<Box className="size-3 shrink-0" />
						<span className="truncate">{`Target: ${target}`}</span>
					</span>
				))}
			</div>
			<div className="grid gap-3">
				{running && reason && <p role="status" className="text-xs text-muted">{reason}</p>}
				{state === "failed" && <Notice tone="danger">Something went wrong. Please try again.</Notice>}
				{state === "interrupted" && <Notice tone="danger">The connection to Rhino was interrupted before this task finished.</Notice>}
				{state === "cancelled" && <Notice tone="muted">Stopped.</Notice>}
				{assistantMessages.map((message: any, i: number) => {
					const thinking = message.content.filter((part: any) => part.type === "thinking").map((part: any) => part.thinking ?? part.text).join("\n");
					const text = message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
					if (!thinking && !text) return null;
					return (
						<div key={i} className="min-w-0">
							{thinking && <div className="mb-2"><ThinkingBlock text={thinking} streaming={false} /></div>}
							{text && <div className="min-w-0 text-[14px] leading-7 text-ink"><MessageMarkdown text={text} /></div>}
						</div>
					);
				})}
				{liveMessages.map((message) => (
					<div key={message.id} className="min-w-0">
						{message.thinking && <div className="mb-2"><ThinkingBlock text={message.thinking} streaming={message.streaming && !message.text} /></div>}
						{message.text ? (
							<div className="min-w-0 text-[14px] leading-7 text-ink">
								<MessageMarkdown text={message.text} />
								{message.streaming && <span aria-hidden="true" className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-accent animate-blink" />}
							</div>
						) : !message.thinking ? (
							<p className="flex items-center gap-2 text-[13px] text-muted" role="status">
								<Loader2 className="size-3.5 animate-spin" />
								Getting started…
							</p>
						) : null}
					</div>
				))}
				{idle && (
					<p className="flex items-center gap-2 text-[13px] text-muted" role="status">
						<Loader2 className="size-3.5 animate-spin" />
						Getting started…
					</p>
				)}
				{tools.length > 0 && <ToolHistory tools={tools} />}
				<ImageGallery images={captures.map((capture: { image: ImageAttachment; tool: string }) => ({ image: capture.image, label: `Capture from ${capture.tool}` }))} />
				{questions.map((question) => (
					<Question
						key={String(question.id)}
						question={question}
						enabled={false}
						waiting={state === "awaiting_user"}
						inactive={SETTLED_STATES.includes(state)}
						answer={(value) => commands.answer(String(question.id), value)}
					/>
				))}
				{state === "uncertain" && !recovered && (
					<div className="grid justify-items-start gap-2">
						<Notice tone="muted">Hopper couldn't confirm how this task ended. Check your model and any saved files before continuing.</Notice>
						<Button size="sm" variant="secondary" disabled={!commands.recoveryEnabled} onClick={() => commands.recover(String(task.id), "User checked the model and saved files and requested permission for new work.")}>
							I've checked, continue
						</Button>
					</div>
				)}
				{recovered && (
					<Notice tone="muted">You can send a new message. This task's result remains unknown and it won't be repeated automatically.</Notice>
				)}
			</div>
		</div>
	);
}

function TaskCard({ task, snapshot, labelFor, commands }: {
	task: Row;
	snapshot: SharedSnapshot;
	labelFor(binding: TargetBinding): string;
	commands: TaskThreadCommands;
}) {
	const input = decode<TaskInput>(task.payload, { text: "", bindings: [] });
	const inputs = snapshot.inputs?.filter((entry) => entry.task_id === task.id) ?? [];
	return (
		<article className="flex flex-col gap-6">
			<UserBubble text={input.text} attachments={input.attachments} kind={input.kind === "follow_up" ? "follow_up" : undefined} />
			{inputs.map((entry) => {
				const payload = decode<{ text: string; attachments?: unknown }>(entry.payload, { text: "" });
				return (
					<UserBubble
						key={String(entry.id)}
						text={payload.text}
						attachments={payload.attachments}
						kind="steer"
						status={entry.state === "not_applied" ? "Not delivered" : entry.state === "unknown" ? "Delivery unconfirmed" : undefined}
					/>
				);
			})}
			<TaskReply task={task} snapshot={snapshot} labelFor={labelFor} commands={commands} />
		</article>
	);
}

function ChildTask({ task, snapshot, labelFor, commands }: {
	task: Row;
	snapshot: SharedSnapshot;
	labelFor(binding: TargetBinding): string;
	commands: TaskThreadCommands;
}) {
	const input = decode<TaskInput>(task.payload, { text: "", bindings: [] });
	const state = String(task.state);
	return (
		<details className="group ml-6 rounded-md border border-line bg-surface">
			<summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-ink-soft outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
				<ChevronRight className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90" />
				<Box className="size-3.5 shrink-0 text-muted" />
				<span className="min-w-0 flex-1 truncate font-medium">{input.bindings.map(labelFor).join(", ") || "Rhino work"}</span>
				<span className={cn("shrink-0 text-xs", state === "failed" ? "text-danger" : "text-muted")}>
					{state === "running" || state === "suspending"
						? <TaskWorkingTime task={task} turns={snapshot.turns} inline />
						: state === "failed" ? "Failed" : state === "completed" ? "Done" : state === "queued" ? "Queued" : ""}
				</span>
			</summary>
			<div className="border-t border-line px-3 py-3">
				<TaskCard task={task} snapshot={snapshot} labelFor={labelFor} commands={commands} />
			</div>
		</details>
	);
}

export function TaskThread({ snapshot, tasks, connected, conversationId, labelFor, commands, onSuggestion, onHistoryPage, onBottomChange, controlTasks = tasks }: {
	snapshot: SharedSnapshot | undefined;
	/** Root tasks in order, each followed by its child tasks. */
	tasks: Row[];
	connected: boolean;
	conversationId: string;
	labelFor(binding: TargetBinding): string;
	commands: TaskThreadCommands;
	onSuggestion(prompt: string): void;
	onHistoryPage?(before?: number): void;
	onBottomChange?(atBottom: boolean): void;
	controlTasks?: Row[];
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const scrollPosition = useRef<{ top: number; height: number; viewport: number } | undefined>(undefined);
	const [showJump, setShowJump] = useState(false);
	const [focusedQuestionId, setFocusedQuestionId] = useState<string>();
	// Show one answerable question at a time, including questions from workers.
	const waitingTasks = new Map(controlTasks.filter((task) => task.state === "awaiting_user").map((task) => [task.id, task]));
	const pendingQuestions = snapshot?.questions.filter((question) => question.answer === null && waitingTasks.has(question.task_id)) ?? [];
	const activeQuestion = pendingQuestions.find((question) => question.id === focusedQuestionId) ?? pendingQuestions[0];
	const activeQuestionId = activeQuestion?.id;
	useEffect(() => {
		setFocusedQuestionId(activeQuestionId === undefined ? undefined : String(activeQuestionId));
	}, [activeQuestionId]);
	const questionTask = activeQuestion && waitingTasks.get(activeQuestion.task_id);
	const questionTurn = snapshot?.turns.find((turn) => turn.id === activeQuestion?.turn_id);
	const questionOwner = decode<{ binding?: TargetBinding } | null>(questionTurn?.owner, null);
	const questionInput = decode<TaskInput>(questionTask?.payload, { text: "", bindings: [] });
	const questionBindings = questionOwner?.binding ? [questionOwner.binding] : questionInput.messageTarget ? [questionInput.messageTarget] : questionInput.bindings;
	const questionTarget = questionBindings.length ? `Target: ${questionBindings.map(labelFor).join(", ")}` : "Conversation";

	const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
		const node = scroller.current;
		if (!node) return;
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		node.scrollTo({ top: node.scrollHeight, behavior: reducedMotion ? "auto" : behavior });
	};
	const onScroll = useCallback((trackIntent = false) => {
		const node = scroller.current;
		if (!node) return;
		const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
		const previous = scrollPosition.current;
		// Resizing can clamp scrollTop and emit a scroll event. Only movement within
		// unchanged geometry changes whether we follow new messages.
		if (trackIntent && previous && previous.height === node.scrollHeight && previous.viewport === node.clientHeight && previous.top !== node.scrollTop) {
			stickToBottom.current = distance < 80;
		}
		scrollPosition.current = { top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight };
		onBottomChange?.(stickToBottom.current && snapshot?.history?.before == null);
		setShowJump(distance > 240);
	}, [onBottomChange, snapshot?.history?.before]);
	// A question always reveals itself; otherwise follow only while the reader is near the bottom.
	useLayoutEffect(() => {
		if (activeQuestionId) stickToBottom.current = true;
		if (stickToBottom.current && snapshot?.history?.before == null) scrollToLatest("auto");
	}, [activeQuestionId, conversationId, snapshot?.eventCursor, tasks.length]);
	useLayoutEffect(() => {
		if (snapshot?.history?.before != null) {
			stickToBottom.current = false;
			if (scroller.current) scroller.current.scrollTop = 0;
		} else {
			stickToBottom.current = true;
			scrollToLatest("auto");
		}
		onScroll();
	}, [conversationId, snapshot?.history?.before, onScroll]);

	useLayoutEffect(() => {
		const node = scroller.current;
		if (!node || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (stickToBottom.current && snapshot?.history?.before == null) node.scrollTop = node.scrollHeight;
			onScroll();
		});
		observer.observe(node);
		if (node.firstElementChild) observer.observe(node.firstElementChild);
		return () => observer.disconnect();
	}, [onScroll, snapshot?.history?.before]);

	return (
		<div className="relative min-h-0 flex-1">
			{commands.enabled !== false && activeQuestion && <Question
				key={String(activeQuestion.id)}
				question={activeQuestion}
				enabled
				waiting
				target={questionTarget}
				queued={pendingQuestions.length - 1}
				answer={(value) => commands.answer(String(activeQuestion.id), value)}
			/>}
			<div ref={scroller} onScroll={() => onScroll(true)} className="h-full overflow-y-auto px-4 py-6 sm:px-6" aria-label="Conversation" aria-live="polite">
				<div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 pb-4">
					{snapshot?.history && onHistoryPage && <div className="flex justify-center gap-2">
						{snapshot.history.hasOlder && <Button variant="ghost" size="sm" disabled={!connected} onClick={() => onHistoryPage(Number(snapshot.history!.oldestSequence))}>Older messages</Button>}
						{snapshot.history.before !== null && <Button variant="ghost" size="sm" disabled={!connected} onClick={() => onHistoryPage()}>Latest messages</Button>}
					</div>}
					{!snapshot || tasks.length === 0 ? (
						<Welcome connected={connected && commands.enabled !== false} onSuggestion={onSuggestion} />
					) : (
						tasks.map((task) =>
							task.parent_task_id ? (
								<ChildTask key={String(task.id)} task={task} snapshot={snapshot} labelFor={labelFor} commands={commands} />
							) : (
								<TaskCard key={String(task.id)} task={task} snapshot={snapshot} labelFor={labelFor} commands={commands} />
							),
						)
					)}
				</div>
			</div>
			{showJump && (
				<Button
					size="sm"
					variant="secondary"
					className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-pop animate-pop-in"
					// Keep the composer from collapsing and moving this button before pointer-up.
					onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
					onClick={() => {
						stickToBottom.current = true;
						scrollToLatest();
					}}
				>
					<ArrowDown className="size-3.5" />
					Jump to latest
				</Button>
			)}
		</div>
	);
}
