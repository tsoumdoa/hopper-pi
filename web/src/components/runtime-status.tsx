import { ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { RuntimeStatus } from "../../../src/protocol/v2.js";
import { cn, titleCase } from "../lib/utils";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export function summarizeRuntimeStatus(status: RuntimeStatus | null, error: string | null) {
	if (error) return { tone: "danger" as const, text: "Status unavailable" };
	if (!status) return { tone: "muted" as const, text: "Waiting for Rhino" };
	const lifecycleState = status.lifecycle.state;
	const tone = lifecycleState === "faulted" ? ("danger" as const) : lifecycleState === "running" ? ("ok" as const) : ("warn" as const);
	const document = status.rhino.documentName ?? status.grasshopper.documentName;
	return { tone, text: `${titleCase(lifecycleState)}${document ? ` · ${document}` : ""}` };
}

export function runtimeStatusRows(status: RuntimeStatus): Array<[string, string]> {
	const failures = status.host.healthFailureCount;
	return [
		["Lifecycle", `${titleCase(status.lifecycle.state)}${status.lifecycle.reason ? ` (${status.lifecycle.reason.code}: ${status.lifecycle.reason.message})` : ""}`],
		["Transport", status.transport.ready ? "Ready" : "Not ready"],
		["Instance", status.transport.lifecycleInstanceId ?? "Not assigned"],
		[
			"Host",
			[
				titleCase(status.host.state),
				status.host.processId == null ? "PID unavailable" : `PID ${status.host.processId}`,
				status.host.nodeVersion ? `Node ${status.host.nodeVersion}` : null,
				`${titleCase(status.host.handshake)} handshake`,
				`${failures} health failure${failures === 1 ? "" : "s"}`,
			].filter(Boolean).join(" · "),
		],
		["Rhino", status.rhino.activeDocument ? status.rhino.documentName ?? "Active, untitled" : "No active document"],
		["Grasshopper", titleCase(status.grasshopper.state)],
		["GH document", status.grasshopper.activeDocument ? status.grasshopper.documentName ?? "Active, untitled" : "No active document"],
		["Dispatcher", `${status.dispatcher.depth}/${status.dispatcher.capacity} queued · ${status.dispatcher.acceptingExternalWork ? "accepting work" : "not accepting work"}`],
	];
}

export function RuntimeStatusPanel({
	status,
	error,
	onRefresh,
	refreshing,
	defaultOpen = false,
}: {
	status: RuntimeStatus | null;
	error: string | null;
	onRefresh(): void;
	refreshing: boolean;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const summary = summarizeRuntimeStatus(status, error);
	const rows = status ? runtimeStatusRows(status) : [];
	const errors = status
		? Object.entries(status.errors).flatMap(([component, value]) => value ? [[component, value] as const] : [])
		: [];

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-line bg-surface">
			<div className="flex items-center gap-1 py-1 pl-2.5 pr-1">
				<CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
					<span
						aria-hidden="true"
						className={cn(
							"size-1.5 shrink-0 rounded-full",
							summary.tone === "ok" && "bg-accent",
							summary.tone === "warn" && "bg-warn",
							summary.tone === "danger" && "bg-danger",
							summary.tone === "muted" && "bg-line-strong animate-pulse",
						)}
					/>
					<span className="min-w-0 flex-1">
						<span className="block text-xs font-medium text-ink">Rhino runtime</span>
						<span className="block truncate text-[11px] text-muted">{summary.text}</span>
					</span>
					<ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" />
				</CollapsibleTrigger>
				<Button size="icon-sm" variant="ghost" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Rhino status" title="Refresh Rhino status">
					<RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
				</Button>
			</div>
			<CollapsibleContent className="border-t border-line px-2.5 pb-2.5 pt-2 text-xs">
				{error && <p className="mb-2 rounded-sm bg-danger-soft px-2 py-1.5 text-danger">Rhino status unavailable: {error}</p>}
				{status ? (
					<>
						<dl className="grid gap-1.5">
							{rows.map(([label, value]) => (
								<div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2" key={label}>
									<dt className="text-muted">{label}</dt>
									<dd className="m-0 break-words text-ink-soft">{value}</dd>
								</div>
							))}
						</dl>
						<div className="mt-3 border-t border-line pt-2">
							<p className="text-[10px] font-medium uppercase tracking-wider text-muted">Component errors</p>
							{errors.length ? (
								<ul className="mt-1 grid gap-1 text-danger">
									{errors.map(([component, value]) => (
										<li key={component}>{titleCase(component)} · {value?.code}: {value?.message}</li>
									))}
								</ul>
							) : (
								<p className="mt-1 text-muted">None</p>
							)}
						</div>
						<p className="mt-2 text-[11px] text-muted">Snapshot revision {status.revision}</p>
					</>
				) : (
					!error && <p className="text-muted">Waiting for the first Rhino status snapshot.</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
