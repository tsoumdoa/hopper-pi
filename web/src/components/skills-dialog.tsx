import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Copy, RefreshCw } from "lucide-react";
import type { SkillLibrarySnapshot, SkillLibraryUpdate, SkillSummary } from "../../../src/host/protocol.js";
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

function SkillRow({ skill, disabled, onToggle, onView }: {
	skill: SkillSummary;
	disabled: boolean;
	onToggle(enabled: boolean): void;
	onView(): void;
}) {
	return (
		<div className="flex items-start gap-3 rounded-md border border-line p-3">
			<input type="checkbox" role="switch" aria-label={`Enable ${skill.name}`} checked={skill.enabled} disabled={disabled}
				onChange={(event) => onToggle(event.target.checked)} className="mt-1 size-4 shrink-0 accent-accent" />
			<div className="min-w-0 flex-1">
				<button type="button" onClick={onView} className="text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:underline">{skill.name}</button>
				<p className="mt-1 text-xs leading-5 text-ink-soft">{skill.description}</p>
				<p className="mt-1 text-[11px] text-muted">
					{skill.source === "bundled" ? "Bundled" : "Your Markdown"} · {skill.enabled ? skill.manualOnly ? "Manual invocation only" : "Available to agent" : "Disabled"}
				</p>
			</div>
			<Button variant="ghost" size="xs" onClick={onView} aria-label={`View ${skill.name}`}><BookOpen className="size-3" />View</Button>
		</div>
	);
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
	const [viewed, setViewed] = useState<SkillSummary | null>(null);
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

	useEffect(() => {
		if (!file || !connected) return;
		let cancelled = false;
		void requestSkills<{ content: string }>(token, undefined, file).then(
			(result) => { if (!cancelled) setContent(result.content); },
			(reason) => { if (!cancelled) setContent(reason instanceof Error ? reason.message : String(reason)); },
		);
		return () => { cancelled = true; };
	}, [connected, file, token, library]);

	const view = (skill: SkillSummary) => { setViewed(skill); setContent("Loading…"); setFile(skill.path); };
	const enabled = library?.skills.filter((skill) => skill.enabled).length ?? 0;

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="w-[min(760px,calc(100%-2rem))]">
				<DialogHeader>
					<DialogTitle>Skills & Markdown</DialogTitle>
					<DialogDescription>Choose the instructions and references Hopper can read. Enabled skills are available when relevant to your request.</DialogDescription>
				</DialogHeader>
				{!connected && <p role="status" className="text-xs text-warn">Reconnect to manage skills.</p>}
				{error && <p role="alert" className="text-xs text-danger">{error}</p>}
				{viewed ? (
					<div className="grid min-h-0 gap-3">
						<Button variant="ghost" size="sm" className="justify-self-start" onClick={() => { setViewed(null); setFile(""); }}>← All skills</Button>
						<p className="text-sm font-medium">{viewed.name}</p>
						<Label htmlFor="skill-file">File</Label>
						<select id="skill-file" className="w-full rounded-md border border-line bg-surface p-2 text-xs" value={file} onChange={(event) => { setContent("Loading…"); setFile(event.target.value); }}>
							{(library?.skills.find((skill) => skill.id === viewed.id)?.files ?? viewed.files).map((path) => <option key={path} value={path}>{path}</option>)}
						</select>
						<pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel p-3 text-xs leading-5">{content}</pre>
					</div>
				) : (
					<>
						<div className="grid gap-2 rounded-md border border-line bg-panel p-3">
							<Label htmlFor="skill-folder">Your Markdown folder</Label>
							<p className="text-xs leading-5 text-ink-soft">Drop .md files into this folder using Finder or File Explorer. Hopper discovers them automatically before your next message; this list refreshes every 3 seconds while idle.</p>
							<div className="flex flex-wrap gap-2">
								<Input id="skill-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setCopied(false); }} className="min-w-0 flex-1 text-xs" placeholder="Absolute folder path" disabled={!library} />
								<Button size="sm" variant="secondary" disabled={!library} onClick={() => {
									void navigator.clipboard.writeText(library!.folder).then(() => setCopied(true), () => setError("Could not copy. Select and copy the folder path above."));
								}}><Copy className="size-3" />{copied ? "Copied" : "Copy path"}</Button>
								<Button size="sm" disabled={!connected || busy || streaming || !folder.trim() || folder === library?.folder} onClick={() => void refresh({ type: "folder", folder: folder.trim() })}>Use folder</Button>
							</div>
							<p className="text-[11px] leading-5 text-muted">Plain Markdown needs no special format. For a skill with references, use a folder containing SKILL.md and related .md files. Optional name and description frontmatter controls how it appears.</p>
						</div>
						<div className="flex items-center justify-between gap-2">
							<p className="text-xs text-muted">{library ? `${enabled} of ${library.skills.length} enabled` : "Loading skills…"}</p>
							<Button size="xs" variant="ghost" disabled={!connected || busy} onClick={() => void refresh()}><RefreshCw className="size-3" />Refresh</Button>
						</div>
						{streaming && <p role="status" className="text-xs text-muted">Hopper is working. You can view skills now and change them when this turn finishes.</p>}
						<div className="grid gap-2">
							{library?.skills.map((skill) => <SkillRow key={skill.id} skill={skill} disabled={!connected || busy || streaming}
								onToggle={(enabled) => void refresh({ type: "toggle", id: skill.id, enabled })} onView={() => view(skill)} />)}
						</div>
						{library?.diagnostics.map((message) => <p key={message} className="break-words text-xs text-warn">{message}</p>)}
						<p className="text-[11px] leading-5 text-muted">Changes are saved on this computer and apply to the next turn. Disabling prevents further reads; text already in this conversation remains. Start a new session for a clean context.</p>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
