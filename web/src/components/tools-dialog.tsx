import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Box, ChevronRight, RefreshCw, Search, Terminal, Workflow, type LucideIcon } from "lucide-react";
import type { AgentToolSummary, AgentToolsSnapshot, ToolSettingsAction, ToolSettingsResult, JsonValue } from "../../../src/host/protocol.js";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

async function toolsRequest(token: string, action?: ToolSettingsAction, signal?: AbortSignal): Promise<Response> {
	if (import.meta.env.MODE === "mock") {
		const { mockToolSettings } = await import("../mocks/tool-settings-mock");
		const result = mockToolSettings(action);
		return new Response(JSON.stringify(result), { status: "ok" in result && !result.ok ? 409 : 200 });
	}
	return fetch("/api/tools", {
		...(action ? { method: "POST", body: JSON.stringify(action) } : {}),
		headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
		cache: "no-store", ...(signal ? { signal } : {}),
	});
}

const TOOL_STATUS: Record<NonNullable<AgentToolSummary["status"]>, string> = {
	"disabled-by-user": "Disabled by you", "parent-disabled": "Plugin or group disabled",
	"api-key-required": "API key required", "images-required": "Image-capable model required",
	"backend-unavailable": "Backend unavailable", "ui-unavailable": "User interface unavailable",
	"settings-unavailable": "Settings unavailable", "credential-store-unavailable": "Credential store unavailable",
	"available-on-demand": "Available on demand", "activation-required": "Activation required",
	"active": "Active", "pending-exposure": "Applies before the next model response",
	"registration-conflict": "Tool name conflicts with another extension",
};

type GroupName = "Rhino" | "Grasshopper" | "General" | "Firecrawl" | "Interaction" | "Skills";

const TOOL_GROUPS: Array<{ name: GroupName; icon: LucideIcon; hint: string }> = [
	{ name: "Rhino", icon: Box, hint: "Document objects, scripts, and viewports" },
	{ name: "Grasshopper", icon: Workflow, hint: "Canvas components, wires, widgets, and scripts" },
	{ name: "Firecrawl", icon: Search, hint: "Web search and webpage reading" },
	{ name: "Interaction", icon: Terminal, hint: "Questions and discovery" },
	{ name: "Skills", icon: Terminal, hint: "Skill references" },
	{ name: "General", icon: Terminal, hint: "Files, search, and questions for you" },
];

function toolGroup(name: string, parent?: string): GroupName {
	if (parent === "firecrawl" || name === "web_search" || name === "web_fetch") return "Firecrawl";
	if (parent === "hopper.interaction") return "Interaction";
	if (parent === "hopper.skills") return "Skills";
	if (name.startsWith("rh_")) return "Rhino";
	if (name.startsWith("gh_")) return "Grasshopper";
	return "General";
}

// JSON Schema helpers. Tool parameters arrive as plain JSON, so every accessor tolerates missing or odd shapes.
type Schema = { [key: string]: JsonValue };

function asSchema(value: JsonValue | undefined): Schema | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (!Array.isArray(value.allOf)) return value;
	// Combine object fields for display without changing the raw schema.
	const parts = [...value.allOf.map(asSchema).filter((part): part is Schema => part !== null), value];
	const properties: Schema = Object.create(null);
	const required = new Set<string>();
	for (const part of parts) {
		const fields = asSchema(part.properties);
		for (const [name, field] of Object.entries(fields ?? {})) {
			properties[name] = name in properties ? { allOf: [properties[name], field] } : field;
		}
		if (Array.isArray(part.required)) part.required.forEach((name) => required.add(String(name)));
	}
	if (!Object.keys(properties).length) return value;
	const { allOf: _allOf, ...rest } = value;
	return { ...rest, properties, required: [...required] };
}

function variantsOf(schema: Schema): Schema[] | null {
	const list = schema.anyOf ?? schema.oneOf;
	if (!Array.isArray(list)) return null;
	const variants = list.map(asSchema).filter((entry): entry is Schema => entry !== null);
	return variants.length ? variants : null;
}

function literal(value: JsonValue) {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function literalOptions(schema: Schema): string[] | null {
	if (Array.isArray(schema.enum)) return schema.enum.map(literal);
	if (schema.const !== undefined) return [literal(schema.const)];
	const variants = variantsOf(schema);
	if (variants?.every((variant) => variant.const !== undefined || Array.isArray(variant.enum))) return variants.flatMap((variant) => literalOptions(variant) ?? []);
	return null;
}

export function schemaType(schema: Schema): string {
	schema = asSchema(schema)!;
	const variants = variantsOf(schema);
	if (variants) return [...new Set(variants.map(schemaType))].join(" | ");
	if (Array.isArray(schema.type)) return schema.type.map(String).join(" | ");
	if (schema.type === "array") {
		const items = asSchema(schema.items);
		const inner = items ? schemaType(items) : "any";
		return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
	}
	if (typeof schema.type === "string") return schema.type;
	if (schema.const !== undefined) return typeof schema.const;
	if (Array.isArray(schema.enum)) return [...new Set(schema.enum.map((value) => typeof value))].join(" | ");
	if (schema.properties) return "object";
	if (Array.isArray(schema.allOf)) return [...new Set(schema.allOf.map(asSchema).filter((part): part is Schema => part !== null).map(schemaType))].join(" & ") || "any";
	return "any";
}

// A variant's discriminator is the property fixed to a single literal, such as `action: "add"`.
function discriminatorOf(variant: Schema) {
	const properties = asSchema(variant.properties);
	const entry = properties && Object.entries(properties).find(([, value]) => asSchema(value)?.const !== undefined);
	return entry ? { name: entry[0], value: literal(asSchema(entry[1])!.const!) } : null;
}

function rangeLabel(schema: Schema) {
	const min = typeof schema.minimum === "number" ? schema.minimum : null;
	const max = typeof schema.maximum === "number" ? schema.maximum : null;
	if (min === null && max === null) return null;
	if (min !== null && max !== null) return `${min} to ${max}`;
	return min !== null ? `at least ${min}` : `at most ${max}`;
}

const MAX_DEPTH = 4;

function ParameterList({ schema, depth = 0, indent = depth > 0, omit }: { schema: Schema; depth?: number; indent?: boolean; omit?: string }) {
	const properties = asSchema(schema.properties);
	if (!properties) return null;
	const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
	const entries = Object.entries(properties).filter(([name]) => name !== omit);
	if (!entries.length) return <p className="mt-1.5 text-[11px] text-muted">No other fields.</p>;
	return (
		<ul className={cn("grid", depth > 0 && "mt-2", indent && "border-l-2 border-line pl-3")}>
			{entries.map(([name, value]) => {
				const param = asSchema(value) ?? {};
				const items = param.type === "array" ? asSchema(param.items) : null;
				const options = literalOptions(param) ?? (items && literalOptions(items));
				const nested = asSchema(param.properties) ? param : items && asSchema(items.properties) ? items : null;
				const variants = nested || options ? null : (variantsOf(param) ?? (items && variantsOf(items)))?.filter((variant) => asSchema(variant.properties));
				const range = rangeLabel(param);
				return (
					<li key={name} className="border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0">
						<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<code className="font-mono text-xs font-semibold">{name}</code>
							<span className="font-mono text-[11px] text-muted">{schemaType(param)}</span>
							{required.has(name) && <span className="text-[10px] font-medium uppercase tracking-wider text-accent">Required</span>}
							{range && <span className="text-[11px] text-muted">{range}</span>}
						</div>
						{typeof param.description === "string" && param.description && <p className="mt-1 text-xs leading-5 text-ink-soft">{param.description}</p>}
						{options && (
							<ul aria-label={`${name} options`} className="mt-1.5 flex flex-wrap gap-1">
								{options.map((option) => <li key={option} className="rounded-sm border border-line bg-panel px-1.5 py-px font-mono text-[11px] text-ink-soft">{option}</li>)}
							</ul>
						)}
						{param.default !== undefined && <p className="mt-1 text-[11px] text-muted">Default <code className="font-mono">{JSON.stringify(param.default)}</code></p>}
						{nested && depth < MAX_DEPTH && <ParameterList schema={nested} depth={depth + 1} />}
						{variants?.length && depth < MAX_DEPTH ? (
							<div className="mt-2 grid gap-2 border-l-2 border-line pl-3">
								<p className="text-[11px] text-muted">One of {variants.length} shapes</p>
								{variants.map((variant, index) => {
									const discriminator = discriminatorOf(variant);
									return (
										<div key={index} className="rounded-md border border-line bg-panel/60 p-2.5">
											<p className="font-mono text-[11px] font-medium text-ink-soft">
												{discriminator ? <>{discriminator.name} = <span className="text-accent">{discriminator.value}</span></> : `Shape ${index + 1}`}
											</p>
											<ParameterList schema={variant} depth={depth + 1} indent={false} omit={discriminator?.name} />
										</div>
									);
								})}
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

function ToolDetail({ tool, onBack }: { tool: AgentToolSummary; onBack(): void }) {
	const group = TOOL_GROUPS.find((entry) => entry.name === toolGroup(tool.name, tool.parent))!;
	const schema = asSchema(tool.parameters);
	const properties = schema && asSchema(schema.properties);
	const count = properties ? Object.keys(properties).length : 0;
	const requiredCount = schema && Array.isArray(schema.required) ? schema.required.length : 0;
	return (
		<article aria-labelledby="tool-detail-title" className="min-w-0">
			<Button variant="ghost" size="xs" className="-ml-2 mb-2 sm:hidden" onClick={onBack}>
				<ArrowLeft className="size-3" />All tools
			</Button>
			<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
				<group.icon aria-hidden="true" className="size-3" />
				<span>{group.name}</span>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-2">
				<h2 id="tool-detail-title" className="break-all font-mono text-base font-semibold tracking-tight">{tool.name}</h2>
				<Badge variant={tool.active ? "accent" : "neutral"} dot className="h-auto min-h-5 whitespace-normal py-0.5">{tool.status ? TOOL_STATUS[tool.status] : tool.active ? "Active" : "Inactive"}</Badge>
			</div>
			<p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-ink-soft">{tool.description}</p>
			{!tool.active && !tool.status && <p className="mt-3 rounded-md border border-line bg-panel px-3 py-2 text-xs leading-5 text-ink-soft">Registered but not enabled right now. Hopper activates it when a task needs it.</p>}
			<section aria-labelledby="tool-parameters-title" className="mt-5">
				<div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
					<h3 id="tool-parameters-title" className="text-xs font-semibold uppercase tracking-wider text-muted">Parameters</h3>
					<span className="text-[11px] text-muted">{count ? `${count} ${count === 1 ? "parameter" : "parameters"}${requiredCount ? ` · ${requiredCount} required` : ""}` : "None"}</span>
				</div>
				{count ? <div className="mt-3"><ParameterList schema={schema!} /></div> : <p className="mt-3 text-xs text-muted">This tool takes no input.</p>}
			</section>
			<details className="group mt-5 text-xs">
				<summary className="flex cursor-pointer list-none items-center gap-1 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
					<ChevronRight aria-hidden="true" className="size-3 transition-transform group-open:rotate-90" />JSON schema
				</summary>
				<pre className="mt-2 overflow-x-auto rounded-md border border-line bg-panel p-3 font-mono text-[11px] leading-5">{JSON.stringify(tool.parameters, null, 2)}</pre>
			</details>
		</article>
	);
}

export function ToolsDialog({ token, connected, onOpenChange }: {
	token: string;
	connected: boolean;
	onOpenChange(open: boolean): void;
}) {
	const [snapshot, setSnapshot] = useState<AgentToolsSnapshot | null>(null);
	const [query, setQuery] = useState("");
	const [activeOnly, setActiveOnly] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [keyMode, setKeyMode] = useState<"save" | "save-and-enable" | null>(null);
	const [key, setKey] = useState("");
	const [keyExpected, setKeyExpected] = useState<NonNullable<NonNullable<AgentToolsSnapshot["settings"]>["version"]> | null>(null);
	const mutation = useRef(false);
	const fetchSequence = useRef(0);
	const contextSequence = useRef(0);
	const latestSnapshot = useRef<AgentToolsSnapshot | null>(null);
	const retiredEpochs = useRef(new Set<string>());
	const applyToolsSnapshot = (next: AgentToolsSnapshot, allowEqualVersion = true) => {
		const previous = latestSnapshot.current?.settings?.version;
		const version = next.settings?.version;
		if (previous && version) {
			if (previous.epoch === version.epoch && (version.revision < previous.revision || (!allowEqualVersion && version.revision === previous.revision))) return;
			if (previous.epoch !== version.epoch) {
				if (!allowEqualVersion || retiredEpochs.current.has(version.epoch)) return;
				retiredEpochs.current.add(previous.epoch);
			}
		}
		latestSnapshot.current = next;
		setSnapshot(next);
	};
	const [revision, setRevision] = useState(0);
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);
	const list = useRef<HTMLElement>(null);

	useEffect(() => {
		latestSnapshot.current = null;
		retiredEpochs.current.clear();
		setSnapshot(null);
	}, [token]);

	useEffect(() => {
		if (!connected) return;
		const controller = new AbortController();
		let inFlight = false;
		const refresh = async () => {
			if (inFlight || mutation.current) return;
			const sequence = ++fetchSequence.current;
			inFlight = true;
			setBusy(true);
			try {
				const response = await toolsRequest(token, undefined, controller.signal);
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || `Tools request failed (${response.status})`);
				if (!controller.signal.aborted && sequence === fetchSequence.current) { applyToolsSnapshot(result); }
			} catch (reason) {
				if (!controller.signal.aborted && sequence === fetchSequence.current) setError(reason instanceof Error ? reason.message : String(reason));
			} finally {
				inFlight = false;
				if (!controller.signal.aborted) setBusy(false);
			}
		};
		void refresh();
		// Websocket events carry changes immediately; polling recovers missed events.
		const timer = window.setInterval(() => void refresh(), 30_000);
		return () => { controller.abort(); window.clearInterval(timer); };
	}, [connected, token, revision]);

	const update = async (action: ToolSettingsAction) => {
		if (!connected || mutation.current) return;
		mutation.current = true;
		const sequence = ++fetchSequence.current;
		const context = contextSequence.current;
		setSaving(true);
		setError(null);
		try {
			const response = await toolsRequest(token, action);
			const result = await response.json() as ToolSettingsResult;
			if (context !== contextSequence.current) return;
			if (result.snapshot) applyToolsSnapshot(result.snapshot, sequence === fetchSequence.current);
			if (!response.ok || !result.ok) {
				if (result.code === "conflict" && action.type === "credential") { setKey(""); setKeyMode(null); }
				setError(result.code === "conflict" ? "Settings changed in another window; review and try again." : result.error || "Could not save tool settings. Try again.");
				return;
			}
			if (action.type === "credential") { setKey(""); setKeyMode(null); }
		} catch { if (context === contextSequence.current) setError("Could not save tool settings. Reconnect and try again."); }
		finally { mutation.current = false; setSaving(false); }
	};
	useEffect(() => {
		const changed = (event: Event) => {
			if (!connected) return;
			++fetchSequence.current;
			applyToolsSnapshot((event as CustomEvent<AgentToolsSnapshot>).detail);
		};
		const sessionChanged = () => {
			++contextSequence.current;
			++fetchSequence.current;
			latestSnapshot.current = null;
			retiredEpochs.current.clear();
			setSnapshot(null);
			setRevision((value) => value + 1);
		};
		window.addEventListener("hopper-tool-settings", changed);
		window.addEventListener("hopper-tools-session-changed", sessionChanged);
		return () => {
			++contextSequence.current;
			++fetchSequence.current;
			window.removeEventListener("hopper-tool-settings", changed);
			window.removeEventListener("hopper-tools-session-changed", sessionChanged);
		};
	}, [connected, token]);
	const expected = snapshot?.settings?.version;
	const controlsDisabled = !connected || saving || !expected;
	const toggleParent = (id: string, enabled: boolean) => {
		if (!expected) return;
		if (id === "firecrawl" && enabled && snapshot?.settings?.credential === "missing") { setKey(""); setKeyExpected(expected); setKeyMode("save-and-enable"); return; }
		void update({ type: "patch", expected, patch: { target: "parents", id, enabled } });
	};

	const search = query.trim().toLowerCase();
	const filtered = search || activeOnly;
	const visible = snapshot?.tools.filter((tool) => (!activeOnly || tool.active)
		&& `${toolGroup(tool.name, tool.parent)} ${tool.name} ${tool.description}`.toLowerCase().includes(search)) ?? [];
	const groups = TOOL_GROUPS.map((group) => ({ ...group, tools: visible.filter((tool) => toolGroup(tool.name, tool.parent) === group.name) }))
		.filter((group) => group.tools.length > 0);
	const ordered = groups.flatMap((group) => group.tools);
	const active = snapshot?.tools.filter((tool) => tool.active).length ?? 0;
	const selected = ordered.find((tool) => tool.name === selectedName) ?? ordered[0] ?? null;

	useEffect(() => {
		list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
	}, [selected?.name]);

	const select = (tool: AgentToolSummary, openDetail = false) => {
		setSelectedName(tool.name);
		if (openDetail) setDetailOpen(true);
	};

	const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (!ordered.length) return;
		const index = ordered.findIndex((tool) => tool.name === selected?.name);
		const next = event.key === "ArrowDown" ? Math.min(ordered.length - 1, index + 1)
			: event.key === "ArrowUp" ? Math.max(0, index - 1)
			: event.key === "Home" ? 0
			: event.key === "End" ? ordered.length - 1
			: -1;
		if (next < 0) return;
		event.preventDefault();
		select(ordered[next]);
		Array.from(list.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? []).find((button) => button.dataset.tool === ordered[next].name)?.focus();
	};

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="h-[min(680px,calc(100dvh-2rem))] w-[min(920px,calc(100%-2rem))] overflow-hidden">
				<DialogHeader>
					<DialogTitle>Agent tools</DialogTitle>
					<DialogDescription>Choose which tools Hopper may use. Saved choices apply to current and future conversations in this profile.</DialogDescription>
				</DialogHeader>
				{!connected && <p role="status" className="text-xs text-warn">Disconnected. Reconnect to update this list.</p>}
				{snapshot?.settings?.error && <p role="alert" className="text-xs text-danger">{snapshot.settings.error}</p>}
				{saving && <p role="status" className="text-xs text-muted">Saving…</p>}
				{error && <p role="alert" className="text-xs text-danger">Could not update tools: {error}</p>}
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative min-w-0 flex-1 basis-48">
						<Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
						<Input aria-label="Search tools" placeholder="Search tools…" value={query} onChange={(event) => { setQuery(event.target.value); setDetailOpen(false); }} className="pl-8" />
					</div>
					<Button variant={activeOnly ? "default" : "secondary"} size="sm" aria-pressed={activeOnly} onClick={() => { setActiveOnly((value) => !value); setDetailOpen(false); }}>
						Active only
					</Button>
					<Button variant="secondary" size="sm" disabled={!connected || busy} onClick={() => { setError(null); setRevision((value) => value + 1); }}>
						<RefreshCw className={cn("size-3.5", busy && "animate-spin")} />Refresh
					</Button>
				</div>
				{snapshot?.settings && <div className="flex flex-wrap items-center gap-2">
					<Button size="xs" variant="secondary" disabled={!connected || saving} onClick={() => void update({ type: "check-connection" })}>Check connection</Button>
					<span className="text-xs text-muted">Firecrawl: {snapshot.settings.credential === "configured" ? "API key saved" : snapshot.settings.credential === "unavailable" ? "Credential store unavailable" : "API key required"}</span>
					<Button size="xs" variant="secondary" disabled={controlsDisabled} onClick={() => { setKey(""); setKeyExpected(expected ?? null); setKeyMode("save"); }}>Manage API key</Button>
					<Button size="xs" variant="ghost" disabled={!connected || saving} onClick={() => {
						if (window.confirm("Restore tool defaults and disconnect the saved Firecrawl key? Firecrawl will be disabled.")) void update(expected ? { type: "reset", expected } : { type: "repair" });
					}}>{expected ? "Reset tools" : "Repair settings"}</Button>
				</div>}
				{keyMode && <Dialog open onOpenChange={(open) => { if (!open && !saving) { setKey(""); setKeyMode(null); } }}>
					<DialogContent hideClose={saving}>
					<DialogHeader><DialogTitle>Firecrawl API key</DialogTitle><DialogDescription>{keyMode === "save-and-enable" ? "Set up Firecrawl for web search and webpage reading." : "Save, replace, or remove your Firecrawl key."}</DialogDescription></DialogHeader>
					<section aria-label="Firecrawl setup" className="grid gap-3">
					{saving && <p role="status" className="text-xs text-muted">Saving…</p>}
					{!connected && <p role="status" className="text-xs text-warn">Reconnect to manage your key.</p>}
					{error && <p role="alert" className="text-xs text-danger">{error}</p>}
					<p className="text-xs">Search queries and requested URLs are sent to Firecrawl and may consume credits on your account. Your key is kept in your operating system's protected credential store.</p>
					<Input type="password" aria-label="Firecrawl API key" autoComplete="off" maxLength={4096} value={key} onChange={(event) => setKey(event.target.value)} disabled={saving} />
					<div className="flex flex-wrap gap-2">
						<Button size="sm" disabled={controlsDisabled || !key.trim()} onClick={() => { if (keyExpected) { const value = key; setKey(""); void update({ type: "credential", expected: keyExpected, action: keyMode, key: value }); } }}>{keyMode === "save-and-enable" ? "Save key and enable" : snapshot?.settings?.credential === "configured" ? "Save replacement" : "Save key"}</Button>
						{keyMode === "save" && <Button size="sm" variant="secondary" disabled={controlsDisabled} onClick={() => { if (keyExpected) void update({ type: "credential", expected: keyExpected, action: "remove" }); }}>Remove key</Button>}
						<Button size="sm" variant="ghost" disabled={saving} onClick={() => { setKey(""); setKeyMode(null); }}>Cancel</Button>
					</div>
				</section>
				</DialogContent></Dialog>}
				<p role="status" className="-mt-2 text-xs text-muted">
					{snapshot ? `${active} active · ${snapshot.tools.length} registered${filtered ? ` · ${visible.length} matching` : ""}` : connected && busy ? "Loading tools…" : "Tool list unavailable."}
				</p>
				<div className="grid min-h-0 flex-1 overflow-hidden rounded-md border border-line sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
					<nav
						ref={list}
						aria-label="Tools"
						onKeyDown={onListKeyDown}
						className={cn("min-h-0 overflow-y-auto bg-panel sm:border-r sm:border-line", detailOpen ? "hidden sm:block" : "block")}
					>
						{groups.map((group) => (
							<section key={group.name} aria-labelledby={`tools-group-${group.name}`}>
								<div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel/95 px-3 py-1.5 backdrop-blur">
									<group.icon aria-hidden="true" className="size-3 text-muted" />
									<h2 id={`tools-group-${group.name}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted">{group.name}</h2>
									{snapshot?.settings?.parents.filter((parent) => group.tools.some((tool) => tool.parent === parent.id)).map((parent) => <input key={parent.id} type="checkbox" role="switch" aria-label={`Enable ${parent.name}`} checked={parent.enabled} disabled={controlsDisabled} onChange={(event) => toggleParent(parent.id, event.target.checked)} className="ml-auto size-4 accent-accent" />)}
									<span title={`${group.tools.filter((tool) => tool.active).length} active of ${group.tools.length}`} className="ml-auto text-[11px] tabular-nums text-muted">{group.tools.filter((tool) => tool.active).length}/{group.tools.length}</span>
								</div>
								<ul className="py-1">
									{group.tools.map((tool) => {
										const current = tool.name === selected?.name;
										return (
											<li key={tool.name}>
												<button
													type="button"
													data-tool={tool.name}
													aria-current={current ? "true" : undefined}
													onClick={() => select(tool, true)}
													className={cn(
														"relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40",
														current && "bg-surface text-ink before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:rounded-r before:bg-accent",
													)}
												>
													<span aria-hidden="true" className={cn("mt-[7px] size-1.5 rounded-full", tool.active ? "bg-accent" : "border border-line-strong")} />
													<span className="min-w-0">
														<span title={tool.name} className="block truncate font-mono text-xs font-medium">{tool.name}</span>
														<span className="block truncate text-[11px] text-muted">{tool.description}</span>
													</span>
													<ChevronRight aria-hidden="true" className="mt-1 size-3.5 text-muted sm:hidden" />
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						))}
						{snapshot && !visible.length && (
							<p className="px-4 py-8 text-center text-xs text-muted">
								{!snapshot.tools.length ? "No tools are registered in this session." : activeOnly && !search ? "No tools are active right now." : "No tools match your search."}
							</p>
						)}
					</nav>
					<div className={cn("min-h-0 overflow-y-auto bg-surface p-4 sm:p-5", detailOpen ? "block" : "hidden sm:block")}>
						{!selected && <Button variant="ghost" size="xs" className="-ml-2 mb-2 sm:hidden" onClick={() => setDetailOpen(false)}><ArrowLeft className="size-3" />All tools</Button>}
						{selected ? <>
							{selected.id && snapshot?.settings && <div className="mb-4 grid gap-2">
								<label className="flex items-center gap-2 text-xs"><input type="checkbox" role="switch" aria-label={`Enable ${selected.name}`} checked={selected.enabled ?? false} disabled={controlsDisabled || !snapshot.settings.parents.find((parent) => parent.id === selected.parent)?.enabled} onChange={(event) => { if (expected) void update({ type: "patch", expected, patch: { target: "tools", id: selected.id!, enabled: event.target.checked } }); }} className="size-4 accent-accent" />Enable tool</label>
								{selected.available && !selected.active && selected.enabled && snapshot.settings.parents.find((parent) => parent.id === selected.parent)?.enabled && <Button size="xs" variant="secondary" disabled={controlsDisabled} onClick={() => void update({ type: "activate", id: selected.id! })}>Activate for this session</Button>}
							</div>}
							{!selected.id && snapshot?.settings && <p className="mb-2 text-xs text-muted">Unmanaged tool</p>}
							<ToolDetail key={selected.name} tool={selected} onBack={() => setDetailOpen(false)} />
						</> : (
							<p className="py-8 text-center text-xs text-muted">{snapshot ? "Select a tool to see what it does and what it needs." : connected && busy ? "Loading tools…" : "Tool details unavailable."}</p>
						)}
					</div>
				</div>
				<p className="text-[11px] text-muted">Tool switches control named calls. General-purpose script tools may still perform equivalent operations.</p>
			</DialogContent>
		</Dialog>
	);
}
