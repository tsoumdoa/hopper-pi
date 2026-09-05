import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClientMessage } from "../../../src/host/protocol.js";
import { cn } from "../lib/utils";
import type { UiRequest } from "../state/hopper-types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKicker, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

function resolveKind(request: UiRequest) {
	if (request.kind === "auth") return request.options?.length ? "select" : "input";
	return request.kind;
}

export function UiRequestDialog({
	request,
	queued,
	send,
	onResolved,
}: {
	request: UiRequest | null;
	queued: number;
	send(message: ClientMessage): boolean;
	onResolved(): void;
}) {
	const [value, setValue] = useState("");
	useEffect(() => setValue(request?.prefill ?? request?.options?.[0]?.value ?? ""), [request]);
	if (!request) return null;

	const kind = resolveKind(request);
	const finish = (cancelled = false) => {
		const result = cancelled ? (kind === "confirm" ? false : null) : kind === "confirm" ? true : value;
		const sent = send({ type: "ui_response", requestId: request.requestId, value: result });
		// Allow local dismissal while offline so the user can reach Reconnect.
		// The host replays unanswered requests when this tab connects again.
		if (sent || cancelled) onResolved();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) finish(true);
			}}
		>
			<DialogContent hideClose>
				<DialogHeader>
					<DialogKicker>Input needed{queued > 0 ? ` · ${queued} more waiting` : ""}</DialogKicker>
					<DialogTitle>{request.title}</DialogTitle>
					{request.description && kind !== "confirm" && <DialogDescription>{request.description}</DialogDescription>}
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						finish();
					}}
				>
					{kind === "select" ? (
						<div className="grid gap-2" role="radiogroup" aria-label={request.title}>
							{request.options?.map((option, index) => {
								const checked = value === option.value;
								return (
									<label
										key={option.id ?? option.value}
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-sm border p-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
											checked ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong hover:bg-surface-muted",
										)}
									>
										<input
											className="sr-only"
											type="radio"
											name="ui-choice"
											value={option.value}
											checked={checked}
											autoFocus={index === 0}
											onChange={(event) => setValue(event.target.value)}
										/>
										<span aria-hidden="true" className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", checked ? "border-accent bg-accent text-white" : "border-line-strong bg-surface")}>
											{checked && <Check className="size-3" />}
										</span>
										<span className="min-w-0">
											<span className="block text-[13px] font-medium text-ink">{option.label}</span>
											{option.description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{option.description}</span>}
										</span>
									</label>
								);
							})}
						</div>
					) : kind === "confirm" ? (
						<p className="rounded-sm border border-line bg-surface-muted p-3 text-[13px] leading-relaxed text-ink-soft">
							{request.description ?? "Continue?"}
						</p>
					) : kind === "editor" ? (
						<Textarea
							autoFocus
							className="min-h-64 font-mono text-xs"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							placeholder={request.placeholder}
							aria-label={request.title}
						/>
					) : (
						<Input
							autoFocus
							type={request.secret ? "password" : "text"}
							autoComplete="off"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							placeholder={request.placeholder}
							aria-label={request.title}
							required
						/>
					)}
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={() => finish(true)}>Cancel</Button>
						<Button type="submit" disabled={kind === "select" && !value}>{kind === "confirm" ? "Confirm" : "Continue"}</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
