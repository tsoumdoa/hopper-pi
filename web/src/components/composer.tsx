import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { cn } from "../lib/utils";
import type { SendMode } from "../state/hopper-types";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const MAX_HEIGHT = 220;

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
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{ draft, onDraftChange, mode, onModeChange, disabled, streaming, onSubmit, onAbort },
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
	const modeHint = mode === "steer"
		? "Sent immediately to redirect the current turn"
		: mode === "follow_up"
			? "Queued until the current turn finishes"
			: "Enter to send · Shift+Enter for a new line";

	return (
		<footer className="shrink-0 px-4 pb-3 pt-2 sm:px-6 lg:px-10">
			<form
				onSubmit={submit}
				className={cn(
					"mx-auto w-full max-w-[780px] rounded-2xl border border-line bg-surface shadow-card transition-[box-shadow,border-color] focus-within:border-accent/40 focus-within:ring-4 focus-within:ring-accent/10",
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
					placeholder={disabled ? "Waiting for the Hopper host…" : "Ask Hopper to work in Rhino or Grasshopper"}
					className="block max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 outline-none placeholder:text-muted disabled:cursor-not-allowed"
				/>
				<div className="flex items-center gap-2 px-2 pb-2 pt-1">
					<Select value={mode} onValueChange={(value) => onModeChange(value as SendMode)}>
						<SelectTrigger aria-label="Message delivery" className="h-8 w-auto max-w-[190px] gap-1.5 border-transparent bg-transparent px-2 text-xs text-ink-soft shadow-none hover:bg-surface-muted">
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="start">
							<SelectItem value="prompt">New turn</SelectItem>
							<SelectItem value="steer">Steer current turn</SelectItem>
							<SelectItem value="follow_up">Follow up after turn</SelectItem>
						</SelectContent>
					</Select>
					<span className="hidden min-w-0 flex-1 truncate text-right text-xs text-muted sm:block">{modeHint}</span>
					<span className="flex-1 sm:hidden" />
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
			<p className="mx-auto mt-2 max-w-[780px] text-center text-[11px] text-muted">
				Hopper can change the active Rhino document and Grasshopper canvas. Review important edits.
			</p>
		</footer>
	);
});
