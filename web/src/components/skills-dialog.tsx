import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, BookOpen, ChevronRight, Copy, FolderOpen, RefreshCw, Search } from "lucide-react";
import type { SkillLibrarySnapshot, SkillLibraryUpdate, SkillSummary } from "../../../src/host/protocol.js";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export async function requestSkills<T>(token: string, update?: SkillLibraryUpdate, file?: string): Promise<T> {
	const response = await fetch(`/api/skills${file ? `?file=${encodeURIComponent(file)}` : ""}`, {
		method: update ? "POST" : "GET",
		headers: { Authorization: `Bearer ${token}`, ...(update ? { "Content-Type": "application/json" } : {}) },
		body: update ? JSON.stringify(update) : undefined,
		cache: "no-store",
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || `Skills request failed (${response.status})`);
	return result as T;
}

export function SkillsDialog({ token, connected, streaming, onOpenChange }: {
	token: string;
	connected: boolean;
	streaming: boolean;
	onOpenChange(open: boolean): void;
}) {
	const [library, setLibrary] = useState<SkillLibrarySnapshot | null>(null);
	const [folder, setFolder] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [enabledOnly, setEnabledOnly] = useState(false);
	const [detailOpen, setDetailOpen] = useState(false);
	const [folderOpen, setFolderOpen] = useState(false);
	const list = useRef<HTMLElement>(null);
	const [file, setFile] = useState("");
	const [content, setContent] = useState("");
	const inFlight = useRef(false);
	const mounted = useRef(true);

	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const refresh = useCallback(async (update?: SkillLibraryUpdate) => {
		if (!connected || inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try {
			const next = await requestSkills<SkillLibrarySnapshot>(token, update);
			if (!mounted.current) return;
			setLibrary(next);
			setError(null);
		} catch (reason) {
			if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			inFlight.current = false;
			if (mounted.current) setBusy(false);
		}
	}, [connected, token]);
	useEffect(() => { if (library) setFolder(library.folder); }, [library?.folder]);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), 3_000);
		return () => window.clearInterval(timer);
	}, [refresh]);

	const search = query.trim().toLowerCase();
	const visible = library?.skills.filter((skill) => (!enabledOnly || skill.enabled)
		&& `${skill.name} ${skill.description} ${skill.source === "bundled" ? "Bundled" : "Your Markdown"} ${skill.path}`.toLowerCase().includes(search)) ?? [];
	const groups = [{ source: "bundled", name: "Bundled", icon: BookOpen }, { source: "user", name: "Your Markdown", icon: FolderOpen }]
		.map((group) => ({ ...group, skills: visible.filter((skill) => skill.source === group.source) }));
	const ordered = groups.flatMap((group) => group.skills);
	const selected = ordered.find((skill) => skill.id === selectedId) ?? ordered[0] ?? null;
	const enabled = library?.skills.filter((skill) => skill.enabled).length ?? 0;
	const activeFile = selected ? selected.files.includes(file) ? file : selected.path : "";

	useEffect(() => {
		list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
	}, [selected?.id]);

	useEffect(() => { setContent(activeFile && connected ? "Loading…" : ""); }, [activeFile, connected]);

	useEffect(() => {
		if (!activeFile || !connected) return;
		let cancelled = false;
		void requestSkills<{ content: string }>(token, undefined, activeFile).then(
			(result) => { if (!cancelled) setContent(result.content); },
			(reason) => { if (!cancelled) setContent(reason instanceof Error ? reason.message : String(reason)); },
		);
		return () => { cancelled = true; };
	}, [connected, activeFile, token, library]);

	const view = (skill: SkillSummary, openDetail = false) => {
		setSelectedId(skill.id);
		setFile(skill.path);
		if (openDetail) setDetailOpen(true);
	};
	const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (!ordered.length) return;
		const index = ordered.findIndex((skill) => skill.id === selected?.id);
		const next = event.key === "ArrowDown" ? Math.min(ordered.length - 1, index + 1)
			: event.key === "ArrowUp" ? Math.max(0, index - 1)
			: event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : -1;
		if (next < 0) return;
		event.preventDefault();
		view(ordered[next]);
		Array.from(list.current?.querySelectorAll<HTMLElement>("[data-skill]") ?? []).find((button) => button.dataset.skill === ordered[next].id)?.focus();
	};

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="h-[min(680px,calc(100dvh-2rem))] w-[min(920px,calc(100%-2rem))] overflow-hidden">
				<DialogHeader>
					<DialogTitle>Skills & Markdown</DialogTitle>
					<DialogDescription>Instructions and references Hopper can read. Enable skills to make them available for your next request.</DialogDescription>
				</DialogHeader>
				{!connected && <p role="status" className="text-xs text-warn">Reconnect to manage skills.</p>}
				{error && <p role="alert" className="text-xs text-danger">{error}</p>}
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative min-w-0 flex-1 basis-48">
						<Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
						<Input aria-label="Search skills" placeholder="Search skills…" value={query} onChange={(event) => { setQuery(event.target.value); setDetailOpen(false); }} className="pl-8" />
					</div>
					<Button variant={enabledOnly ? "default" : "secondary"} size="sm" aria-pressed={enabledOnly} onClick={() => { setEnabledOnly((value) => !value); setDetailOpen(false); }}>Enabled only</Button>
					<Button variant="secondary" size="sm" disabled={!connected || busy} onClick={() => void refresh()}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />Refresh</Button>
					<Button variant={folderOpen ? "default" : "secondary"} size="sm" aria-expanded={folderOpen} aria-controls="skill-folder-settings" onClick={() => setFolderOpen((value) => !value)}><FolderOpen className="size-3.5" />Folder</Button>
				</div>
				{folderOpen && <section id="skill-folder-settings" aria-label="Markdown folder settings" className="grid max-h-[35dvh] shrink-0 gap-2 overflow-y-auto rounded-md border border-line bg-panel p-3">
					<Label htmlFor="skill-folder">Your Markdown folder</Label>
					<p className="text-xs leading-5 text-ink-soft">Add .md files with Finder or File Explorer. Hopper discovers them automatically before your next message.</p>
					<div className="flex flex-wrap gap-2">
						<Input id="skill-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setCopied(false); }} className="min-w-0 flex-1 basis-48 text-xs" placeholder="Absolute folder path" disabled={!library} />
						<Button size="sm" variant="secondary" disabled={!library} onClick={() => {
							void navigator.clipboard.writeText(folder).then(() => setCopied(true), () => setError("Could not copy. Select and copy the folder path above."));
						}}><Copy className="size-3" />{copied ? "Copied" : "Copy path"}</Button>
						<Button size="sm" disabled={!connected || busy || streaming || !folder.trim() || folder.trim() === library?.folder} onClick={() => void refresh({ type: "folder", folder: folder.trim() })}>Use folder</Button>
					</div>
					<p className="text-[11px] leading-5 text-muted">Use plain Markdown, or a folder with SKILL.md and related .md files. Optional name and description frontmatter controls how it appears.</p>
				</section>}
				<p role="status" className="-mt-2 text-xs text-muted">{library ? `${enabled} of ${library.skills.length} enabled${search || enabledOnly ? ` · ${visible.length} matching` : ""}` : connected ? "Loading skills…" : "Skill library unavailable."}</p>
				{streaming && <p role="status" className="text-xs text-muted">Hopper is working. You can view skills now and change them when this turn finishes.</p>}
				<div className="grid min-h-0 flex-1 overflow-hidden rounded-md border border-line sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
					<nav ref={list} aria-label="Skills" onKeyDown={onListKeyDown} className={cn("min-h-0 overflow-y-auto bg-panel sm:border-r sm:border-line", detailOpen ? "hidden sm:block" : "block")}>
						{groups.filter((group) => group.skills.length).map((group) => <section key={group.source} aria-label={group.name}>
							<div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel/95 px-3 py-1.5 backdrop-blur">
								<group.icon aria-hidden="true" className="size-3 text-muted" />
								<h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{group.name}</h2>
								<span title="Enabled / total" className="ml-auto text-[11px] tabular-nums text-muted">{group.skills.filter((skill) => skill.enabled).length}/{group.skills.length}</span>
							</div>
							<ul className="py-1">{group.skills.map((skill) => <li key={skill.id}>
								<button type="button" data-skill={skill.id} aria-label={`View ${skill.name}`} aria-current={skill.id === selected?.id ? "true" : undefined} onClick={() => view(skill, true)} className={cn("relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40", skill.id === selected?.id && "bg-surface text-ink before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:rounded-r before:bg-accent")}>
									<span aria-hidden="true" className={cn("mt-[7px] size-1.5 rounded-full", skill.enabled ? "bg-accent" : "border border-line-strong")} />
									<span className="min-w-0"><span className="block truncate font-mono text-xs font-medium" title={skill.name}>{skill.name}</span><span className="block truncate text-[11px] text-muted">{skill.description}</span><span className="sr-only">{skill.enabled ? "Enabled" : "Disabled"}</span></span>
									<ChevronRight aria-hidden="true" className="mt-1 size-3.5 text-muted sm:hidden" />
								</button>
							</li>)}</ul>
						</section>)}
						{library && !visible.length && <div className="px-4 py-8 text-center text-xs text-muted"><p>{!library.skills.length ? "No skills yet. Add Markdown files to your folder to get started." : "No skills match your filters."}</p>{(search || enabledOnly) && <Button variant="ghost" size="xs" className="mt-2" onClick={() => { setQuery(""); setEnabledOnly(false); }}>Clear filters</Button>}</div>}
					</nav>
					<div className={cn("min-h-0 overflow-y-auto bg-surface p-4 sm:p-5", detailOpen ? "block" : "hidden sm:block")}>
						<Button variant="ghost" size="xs" className="-ml-2 mb-2 sm:hidden" onClick={() => setDetailOpen(false)}><ArrowLeft className="size-3" />All skills</Button>
						{selected ? <article aria-labelledby="skill-detail-title">
							<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted"><BookOpen aria-hidden="true" className="size-3" />{selected.source === "bundled" ? "Bundled" : "Your Markdown"}</div>
							<div className="mt-1 flex flex-wrap items-center gap-2"><h2 id="skill-detail-title" className="break-all font-mono text-base font-semibold tracking-tight">{selected.name}</h2><Badge variant={selected.enabled ? "accent" : "neutral"} dot>{selected.enabled ? "Enabled" : "Disabled"}</Badge></div>
							<p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-ink-soft">{selected.description}</p>
							<label className="mt-4 flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2.5">
								<input type="checkbox" role="switch" aria-label={`Enable ${selected.name}`} checked={selected.enabled} disabled={!connected || busy || streaming} onChange={(event) => void refresh({ type: "toggle", id: selected.id, enabled: event.target.checked })} className="size-4 shrink-0 accent-accent" />
								<span className="text-xs"><span className="block font-medium">Enable skill</span><span className="mt-0.5 block text-muted">{selected.manualOnly ? "Manual invocation only" : "Available to the agent when relevant"}</span></span>
							</label>
							<section aria-label="Markdown preview" className="mt-5">
								<div className="mb-3 flex items-baseline justify-between border-b border-line pb-2"><Label htmlFor="skill-file" className="text-xs uppercase tracking-wider text-muted">File</Label><span className="text-[11px] text-muted">{selected.files.length} {selected.files.length === 1 ? "file" : "files"}</span></div>
								<select id="skill-file" className="w-full min-w-0 rounded-md border border-line bg-surface p-2 text-xs" value={activeFile} onChange={(event) => setFile(event.target.value)}>{selected.files.map((path) => <option key={path} value={path}>{path === selected.path ? path.split(/[\\/]/).pop() : path.startsWith(selected.path.slice(0, selected.path.lastIndexOf("/") + 1)) ? path.slice(selected.path.lastIndexOf("/") + 1) : path}</option>)}</select>
								<p className="mt-2 break-all font-mono text-[10px] leading-4 text-muted">{activeFile}</p>
								<pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel p-3 font-mono text-xs leading-5">{connected ? content : "Reconnect to preview this file."}</pre>
							</section>
						</article> : <p className="py-8 text-center text-xs text-muted">{library ? "Select a skill to read its instructions and references." : connected ? "Loading skills…" : "Skill details unavailable."}</p>}
					</div>
				</div>
				{Boolean(library?.diagnostics.length) && <div role="status" className="max-h-20 shrink-0 overflow-auto rounded-md border border-line bg-panel p-2">{library?.diagnostics.map((message) => <p key={message} className="break-words text-xs text-warn">{message}</p>)}</div>}
				<p className="text-[11px] leading-5 text-muted">Changes apply to the next turn. Disabling stops further reads; text already in this conversation remains. Start a new session for a clean context.</p>
			</DialogContent>
		</Dialog>
	);
}
