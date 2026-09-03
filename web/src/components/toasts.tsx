import { CircleAlert, CircleCheck, ExternalLink, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import type { ToastNotice } from "../state/hopper-types";

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

function Toast({ notice, onDismiss }: { notice: ToastNotice; onDismiss(): void }) {
	// Keep the latest handler without restarting the timer on every parent render.
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;
	useEffect(() => {
		const timer = window.setTimeout(() => dismiss.current(), notice.timeout);
		return () => window.clearTimeout(timer);
	}, [notice.id, notice.timeout]);
	const Icon = ICONS[notice.level];
	return (
		<div
			role={notice.level === "error" ? "alert" : "status"}
			className={cn(
				"pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface p-3 text-sm shadow-pop animate-pop-in",
				notice.level === "error" && "border-danger/30",
				notice.level === "warning" && "border-warn/30",
				notice.level === "success" && "border-accent/30",
				notice.level === "info" && "border-line",
			)}
		>
			<Icon
				className={cn(
					"mt-0.5 size-4 shrink-0",
					notice.level === "error" && "text-danger",
					notice.level === "warning" && "text-warn",
					notice.level === "success" && "text-accent",
					notice.level === "info" && "text-muted",
				)}
			/>
			<div className="min-w-0 flex-1">
				<p className="whitespace-pre-wrap break-words leading-relaxed text-ink">{notice.message}</p>
				{notice.url && (
					<a className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent underline underline-offset-2" href={notice.url} target="_blank" rel="noreferrer noopener">
						{notice.label ?? "Open link"}
						<ExternalLink className="size-3" />
					</a>
				)}
			</div>
			<button
				type="button"
				className="-m-1 rounded-md p-1 text-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
				onClick={onDismiss}
				aria-label="Dismiss notification"
			>
				<X className="size-4" />
			</button>
		</div>
	);
}

export function ToastRegion({ notices, onDismiss }: { notices: ToastNotice[]; onDismiss(id: string): void }) {
	return (
		<div className="pointer-events-none fixed right-4 top-[68px] z-[60] grid w-[min(380px,calc(100%-2rem))] gap-2" aria-live="polite" aria-atomic="false">
			{notices.slice(-4).map((notice) => (
				<Toast key={notice.id} notice={notice} onDismiss={() => onDismiss(notice.id)} />
			))}
		</div>
	);
}
