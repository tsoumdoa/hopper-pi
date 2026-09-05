import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/utils";
import type { SendMode } from "../state/hopper-types";
import { toolbarTriggerClass } from "./model-picker";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const MAX_HEIGHT = 220;

const MODE_LABELS: Record<SendMode, string> = {
	follow_up: "Follow up after turn",
	steer: "Steer current turn",
	prompt: "New turn",
};

export type ComposerHandle = { focus(): void };

export type ComposerProps = {
	draft: string;
	onDraftChange(value: string): void;
	mode: SendMode;
	onModeChange(mode: SendMode): void;
	disabled: boolean;
	streaming: boolean;
	onSubmit(): void;
	onAbort(): void;
	/** Toolbar controls rendered at the start of the bottom row (model, thinking). */
	controls?: ReactNode;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{ draft, onDraftChange, mode, onModeChange, disabled, streaming, onSubmit, onAbort, controls },
	ref,
) {
	const textarea = useRef<HTMLTextAreaElement>(null);
	useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

	useLayoutEffect(() => {
		const node = textarea.current;
		if (!node) return;
		node.style.height = "auto";
		node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
		node.style.overflowY = node.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
	}, [draft]);

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (disabled || !draft.trim()) return;
		onSubmit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	const canSend = !disabled && draft.trim().length > 0;

	return (
		<footer className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
			<form
				onSubmit={submit}
				className={cn(
					"mx-auto w-full max-w-[760px] rounded-md border border-line bg-surface transition-colors focus-within:border-accent/60",
					disabled && "opacity-70",
				)}
			>
				<label className="sr-only" htmlFor="composer-input">Message Hopper</label>
				<textarea
					id="composer-input"
					ref={textarea}
					rows={1}
					value={draft}
					disabled={disabled}
					autoComplete="off"
					onChange={(event) => onDraftChange(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={disabled ? "Waiting for the Hopper host…" : "Ask Hopper…"}
					className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-6 outline-none placeholder:text-muted disabled:cursor-not-allowed"
				/>
				<div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5 pt-0.5">
					{controls}
					{streaming && (
						<Select value={mode} onValueChange={(value) => onModeChange(value as SendMode)}>
							<SelectTrigger aria-label="Message delivery" className={toolbarTriggerClass}>
								<SelectValue>{MODE_LABELS[mode]}</SelectValue>
							</SelectTrigger>
							<SelectContent align="start">
								{(Object.keys(MODE_LABELS) as SendMode[]).map((value) => (
									<SelectItem key={value} value={value}>{MODE_LABELS[value]}</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<span className="flex-1" />
					{streaming && (
						<Button type="button" size="sm" variant="destructive" onClick={onAbort}>
							<Square className="size-3 fill-current" />
							Stop
						</Button>
					)}
					<Button type="submit" size="icon-sm" disabled={!canSend} aria-label="Send message" title="Send (Enter)">
						<ArrowUp className="size-4" />
					</Button>
				</div>
			</form>
		</footer>
	);
});
