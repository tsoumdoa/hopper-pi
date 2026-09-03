import { ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn, titleCase } from "../lib/utils";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type Record_ = Record<string, unknown> | undefined;

function readRecord(value: unknown): Record_ {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function summarize(status: Record<string, unknown> | null, error: string | null) {
	if (error) return { tone: "danger" as const, text: "Status unavailable" };
	if (!status) return { tone: "muted" as const, text: "Waiting for Rhino" };
	const lifecycle = readRecord(status.lifecycle);
	const grasshopper = readRecord(status.grasshopper);
	const lifecycleState = String(lifecycle?.state ?? "unknown");
	const tone = lifecycleState === "faulted" ? ("danger" as const) : lifecycleState === "running" ? ("ok" as const) : ("warn" as const);
	const document = readRecord(status.rhino)?.documentName ?? (grasshopper?.documentName as string | undefined);
	return { tone, text: `${titleCase(lifecycleState)}${document ? ` · ${document}` : ""}` };
}

export function RuntimeStatusPanel({
	status,
	error,
	onRefresh,
	refreshing,
	defaultOpen = false,
}: {
	status: Record<string, unknown> | null;
	error: string | null;
	onRefresh(): void;
	refreshing: boolean;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const summary = summarize(status, error);
	const lifecycle = readRecord(status?.lifecycle);
	const lifecycleReason = readRecord(lifecycle?.reason);
	const transport = readRecord(status?.transport);
	const host = readRecord(status?.host);
	const rhino = readRecord(status?.rhino);
	const grasshopper = readRecord(status?.grasshopper);
	const dispatcher = readRecord(status?.dispatcher);
	const failures = Number(host?.healthFailureCount ?? 0);

	const rows: Array<[string, string]> = status
		? [
			["Lifecycle", `${titleCase(String(lifecycle?.state ?? "unknown"))}${lifecycleReason ? ` (${lifecycleReason.code}: ${lifecycleReason.message})` : ""}`],
			["Transport", transport?.ready ? "Ready" : "Not ready"],
			["Instance", String(transport?.lifecycleInstanceId ?? "Not assigned")],
			[
				"Host",
				[
					titleCase(String(host?.state ?? "unknown")),
					host?.processId == null ? "PID unavailable" : `PID ${host.processId}`,
					host?.nodeVersion ? `Node ${host.nodeVersion}` : null,
					host?.handshake ? `${titleCase(String(host.handshake))} handshake` : null,
					`${failures} health failure${failures === 1 ? "" : "s"}`,
				].filter(Boolean).join(" · "),
			],
			["Rhino", rhino?.activeDocument ? String(rhino.documentName ?? "Active, untitled") : "No active document"],
			["Grasshopper", titleCase(String(grasshopper?.state ?? "unknown"))],
			["GH document", grasshopper?.activeDocument ? String(grasshopper.documentName ?? "Active, untitled") : "No active document"],
			["Dispatcher", `${dispatcher?.depth ?? "?"}/${dispatcher?.capacity ?? "?"} queued · ${dispatcher?.acceptingExternalWork ? "accepting work" : "not accepting work"}`],
		]
		: [];
	const errors = Object.entries((status?.errors ?? {}) as Record<string, { code?: string; message?: string } | null>).filter(([, value]) => value);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-line bg-surface shadow-card">
			<div className="flex items-center gap-1 pl-3 pr-1.5 py-1.5">
				<CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/35">
					<span
						aria-hidden="true"
						className={cn(
							"size-2 shrink-0 rounded-full",
							summary.tone === "ok" && "bg-accent",
							summary.tone === "warn" && "bg-warn",
							summary.tone === "danger" && "bg-danger",
							summary.tone === "muted" && "bg-line-strong animate-pulse",
						)}
					/>
					<span className="min-w-0 flex-1">
						<span className="block text-xs font-semibold text-ink">Rhino runtime</span>
						<span className="block truncate text-[11px] text-muted">{summary.text}</span>
					</span>
					<ChevronDown className="size-4 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" />
				</CollapsibleTrigger>
				<Button size="icon-sm" variant="ghost" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Rhino status" title="Refresh Rhino status">
					<RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
				</Button>
			</div>
			<CollapsibleContent className="border-t border-line px-3 pb-3 pt-2 text-xs">
				{error && <p className="mb-2 rounded-md bg-danger-soft px-2 py-1.5 text-danger">Rhino status unavailable: {error}</p>}
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
							<p className="text-[11px] font-medium uppercase tracking-wide text-muted">Component errors</p>
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
						{status.revision !== undefined && <p className="mt-2 text-[11px] text-muted">Snapshot revision {String(status.revision)}</p>}
					</>
				) : (
					!error && <p className="text-muted">Waiting for the first Rhino status snapshot.</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
