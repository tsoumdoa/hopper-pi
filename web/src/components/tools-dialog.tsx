import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { AgentToolsSnapshot } from "../../../src/host/protocol.js";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const TOOL_GROUPS = ["Rhino", "Grasshopper", "General"] as const;

function toolGroup(name: string) {
	if (name.startsWith("rh_")) return "Rhino";
	if (name.startsWith("gh_")) return "Grasshopper";
	return "General";
}

export function ToolsDialog({ token, connected, onOpenChange }: {
	token: string;
	connected: boolean;
	onOpenChange(open: boolean): void;
}) {
	const [snapshot, setSnapshot] = useState<AgentToolsSnapshot | null>(null);
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [revision, setRevision] = useState(0);

	useEffect(() => {
		if (!connected) return;
		const controller = new AbortController();
		let inFlight = false;
		const refresh = async () => {
			if (inFlight) return;
			inFlight = true;
			setBusy(true);
			try {
				const response = await fetch("/api/tools", {
					headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
				});
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || `Tools request failed (${response.status})`);
				if (!controller.signal.aborted) { setSnapshot(result); setError(null); }
			} catch (reason) {
				if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				inFlight = false;
				if (!controller.signal.aborted) setBusy(false);
			}
		};
		void refresh();
		const timer = window.setInterval(() => void refresh(), 3_000);
		return () => { controller.abort(); window.clearInterval(timer); };
	}, [connected, token, revision]);

	const search = query.trim().toLowerCase();
	const visible = snapshot?.tools.filter((tool) => `${toolGroup(tool.name)} ${tool.name} ${tool.description}`.toLowerCase().includes(search)) ?? [];
	const groups = TOOL_GROUPS.map((name) => ({ name, tools: visible.filter((tool) => toolGroup(tool.name) === name) }))
		.filter((group) => group.tools.length > 0);
	const active = snapshot?.tools.filter((tool) => tool.active).length ?? 0;

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="w-[min(760px,calc(100%-2rem))]">
				<DialogHeader>
					<DialogTitle>Agent tools</DialogTitle>
					<DialogDescription>Tools registered in this session. Active tools are enabled for the agent. Hopper can discover and activate additional tools as needed.</DialogDescription>
				</DialogHeader>
				{!connected && <p role="status" className="text-xs text-warn">Disconnected. Reconnect to update this list.</p>}
				{error && <p role="alert" className="text-xs text-danger">Could not update tools: {error}</p>}
				<div className="flex items-center gap-2">
					<Input aria-label="Search tools" placeholder="Search tools…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1" />
					<Button variant="secondary" size="sm" disabled={!connected || busy} onClick={() => setRevision((value) => value + 1)}>
						<RefreshCw className="size-3.5" />Refresh
					</Button>
				</div>
				<p role="status" className="text-xs text-muted">
					{snapshot ? `${active} active · ${snapshot.tools.length} registered${search ? ` · ${visible.length} matching` : ""}` : connected && busy ? "Loading tools…" : "Tool list unavailable."}
				</p>
				<div className="grid min-h-0 gap-5 overflow-y-auto">
					{groups.map((group) => (
						<section key={group.name} aria-labelledby={`tools-group-${group.name}`} className="grid gap-2">
							<div className="flex items-center justify-between gap-2">
								<h2 id={`tools-group-${group.name}`} className="text-sm font-medium">{group.name}</h2>
								<span className="text-[11px] text-muted">{group.tools.filter((tool) => tool.active).length} active · {group.tools.length} {search ? "matching" : "tools"}</span>
							</div>
							{group.tools.map((tool) => (
								<article key={tool.name} className="min-w-0 rounded-md border border-line">
									<details className="group text-xs">
										<summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-2 rounded-md p-3 hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
											<span title={tool.name} className="truncate font-mono font-medium">{tool.name}</span>
											<span className="truncate text-ink-soft">{tool.description}</span>
											<Badge variant={tool.active ? "accent" : "neutral"}>{tool.active ? "Active" : "Inactive"}</Badge>
											<ChevronRight aria-hidden="true" className="size-3.5 text-muted transition-transform group-open:rotate-90" />
										</summary>
										<div className="min-w-0 border-t border-line p-3">
											<h3 className="break-words font-mono font-medium">{tool.name}</h3>
											<p className="mt-2 whitespace-pre-wrap break-words leading-5 text-ink-soft">{tool.description}</p>
											<h4 className="mt-3 font-medium text-muted">Parameters</h4>
											<pre className="mt-2 overflow-x-auto rounded bg-panel p-2 text-[11px]">{JSON.stringify(tool.parameters, null, 2)}</pre>
										</div>
									</details>
								</article>
							))}
						</section>
					))}
					{snapshot && !visible.length && <p className="py-6 text-center text-xs text-muted">{snapshot.tools.length ? "No tools match your search." : "No tools are registered in this session."}</p>}
				</div>
			</DialogContent>
		</Dialog>
	);
}
