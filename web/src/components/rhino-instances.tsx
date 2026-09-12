import { Box, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";
import { readyTargets, targetName, type SharedSnapshot } from "../state/shared-snapshot";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export type InstanceTone = "ok" | "warn" | "danger" | "muted";

/** One-line summary of the connected Hopper Code instances for the sidebar and the collapsed rail. */
export function summarizeInstances(snapshot: SharedSnapshot | undefined, connected: boolean): { tone: InstanceTone; text: string } {
	if (!connected || !snapshot) return { tone: "muted", text: "Waiting for Hopper" };
	const ready = readyTargets(snapshot);
	if (!ready.length) return { tone: "warn", text: "No Hopper Code instances connected" };
	const documents = ready.reduce((count, target) => count + target.documents.length, 0);
	return {
		tone: "ok",
		text: `${ready.length} ${ready.length === 1 ? "instance" : "instances"} · ${documents} ${documents === 1 ? "document" : "documents"}`,
	};
}

export function RhinoInstancesPanel({ snapshot, connected }: { snapshot: SharedSnapshot | undefined; connected: boolean }) {
	const [open, setOpen] = useState(false);
	const summary = summarizeInstances(snapshot, connected);
	const ready = readyTargets(snapshot);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="rounded-md">
			<CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-2 pl-2.5 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
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
					<span className="block text-xs font-medium text-ink">Hopper Code instances</span>
					<span className="block truncate text-[11px] text-muted">{summary.text}</span>
				</span>
				<ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-180" />
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t border-line px-2.5 pb-2.5 pt-2 text-xs">
				<p className="mb-2 text-muted">Run HopperCode in each Rhino document to make it available here. Documents created or opened through Hopper are added automatically.</p>
				{ready.length ? (
					<ul className="grid gap-2">
						{ready.map((target, index) => (
							<li key={target.lifecycleInstanceId} className="min-w-0">
								<p className="flex items-center gap-1.5 font-medium text-ink">
									<Box className="size-3 shrink-0 text-muted" />
									Hopper Code {index + 1}
									<span className="ml-auto text-[11px] font-normal text-muted">PID {target.processId}</span>
								</p>
								{target.documents.length ? (
									<ul className="mt-1 grid gap-0.5 pl-[18px] text-ink-soft">
										{target.documents.map((document, position) => {
											const name = targetName(document, target.documentLabels);
											return (
												<li key={JSON.stringify(document)} className="truncate">
													{name.startsWith("Untitled") ? `${name} ${position + 1}` : name}
												</li>
											);
										})}
									</ul>
								) : (
									<p className="mt-1 pl-[18px] text-muted">Run HopperCode in a document to add it.</p>
								)}
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted">Run _HopperCode in Rhino to connect an instance.</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
