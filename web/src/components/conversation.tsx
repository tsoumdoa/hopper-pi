import { Brain, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, Loader2, Wrench } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn, formatValue, summarizeValue } from "../lib/utils";
import type { ToolCall } from "../state/hopper-types";
import { Tooltip } from "./ui/tooltip";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const SUGGESTIONS = [
	{ label: "Inspect this canvas", prompt: "Inspect the active Grasshopper canvas and summarize its structure and any errors." },
	{ label: "Create a pavilion", prompt: "Create a simple parametric pavilion on the active Grasshopper canvas. Explain the plan before applying the graph." },
	{ label: "Check the Rhino model", prompt: "Check the active Rhino document and tell me what geometry is present." },
];

function ToolStatusIcon({ status }: { status: ToolCall["status"] }) {
	const icon = status === "running" ? <Loader2 className="size-3.5 animate-spin text-accent" />
		: status === "error" ? <CircleAlert className="size-3.5 text-danger" />
		: <CircleCheck className="size-3.5 text-muted" />;
	return <span role="img" aria-label={status === "running" ? "Running" : status === "error" ? "Failed" : "Done"} className="flex shrink-0">{icon}</span>;
}

export function ToolHistory({ tools }: { tools: ToolCall[] }) {
	const [expanded, setExpanded] = useState(false);
	const id = useId();
	const hidden = Math.max(0, tools.length - 3);
	const label = expanded ? "Show recent tool calls" : `Show ${hidden} earlier tool call${hidden === 1 ? "" : "s"}`;
	return <section aria-label="Tool calls" className="min-w-0">
		{hidden > 0 && <Tooltip content={label}>
			<button type="button" aria-expanded={expanded} aria-controls={id} aria-label={label} onClick={() => setExpanded(!expanded)} className="mb-1 flex min-h-7 w-full items-center justify-center gap-1 rounded-sm text-[11px] text-ink-soft transition-colors hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
				{expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
				<span>{expanded ? "Show recent calls" : `${hidden} earlier tool call${hidden === 1 ? "" : "s"}`}</span>
			</button>
		</Tooltip>}
		<div id={id} className="grid gap-1">{(expanded ? tools : tools.slice(-3)).map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
	</section>;
}

export function ToolCard({ tool }: { tool: ToolCall }) {
	const [open, setOpen] = useState(tool.status === "error");
	useEffect(() => {
		if (tool.status === "error") setOpen(true);
	}, [tool.status]);
	const hasResult = tool.args !== undefined && tool.detail !== tool.args;
	const preview = summarizeValue(tool.status === "running" ? tool.args : tool.detail);
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className={cn(
				"overflow-hidden rounded-[5px] border bg-surface text-xs transition-colors",
				tool.status === "error" ? "border-danger/30" : "border-line hover:border-line-strong",
			)}
		>
			<CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-2 py-1 text-left outline-none transition-colors focus-visible:bg-surface-muted">
				<ChevronRight className="size-3 shrink-0 text-muted transition-transform group-data-[state=open]:rotate-90" />
				<Wrench className="size-3 shrink-0 text-muted" />
				<span className="shrink-0 font-mono text-[11px] font-medium text-ink">{tool.name}</span>
				{preview && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{preview}</span>}
				<ToolStatusIcon status={tool.status} />
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t border-line bg-surface-muted">
				{hasResult && (
					<div className="border-b border-line px-2 py-1.5">
						<p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">Input</p>
						<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-soft">{formatValue(tool.args)}</pre>
					</div>
				)}
				<div className="px-2 py-1.5">
					{hasResult && <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">{tool.status === "error" ? "Error" : "Output"}</p>}
					<pre className={cn("max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed", tool.status === "error" ? "text-danger" : "text-ink-soft")}>
						{formatValue(tool.detail)}
					</pre>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
	return (
		<Collapsible className="text-xs">
			<CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-sm py-0.5 text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40">
				<Brain className={cn("size-3.5", streaming && "animate-pulse text-accent")} />
				<span className="font-medium">{streaming ? "Thinking…" : "Thinking"}</span>
				<ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 leading-5 text-ink-soft">{text}</CollapsibleContent>
		</Collapsible>
	);
}

export function Welcome({ connected, onSuggestion }: { connected: boolean; onSuggestion(prompt: string): void }) {
	return (
		<section className="mx-auto mt-[max(14vh,2rem)] w-full max-w-[560px] animate-slide-up" aria-labelledby="welcome-title">
			<h2 id="welcome-title" className="text-[22px] font-semibold leading-tight tracking-[-.02em]">
				<span className="text-accent-hover">Hopper</span>Code
			</h2>
			<p className="mt-1.5 text-[13px] text-muted">
				{connected ? "Describe a change to the active Grasshopper canvas or Rhino document." : "Connecting to the local Hopper host…"}
			</p>
			<div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Prompt suggestions">
				{SUGGESTIONS.map((suggestion) => (
					<Button key={suggestion.label} size="sm" variant="secondary" disabled={!connected} onClick={() => onSuggestion(suggestion.prompt)}>
						{suggestion.label}
					</Button>
				))}
			</div>
		</section>
	);
}
