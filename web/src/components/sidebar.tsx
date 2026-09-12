import { useShallow } from "zustand/react/shallow";
import { BookOpen, KeyRound, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, Wrench, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useHopperStore } from "../state/hopper-store-context";
import { useRuntimeStatus } from "../hooks/use-runtime-status";
import { cn, providerLabel } from "../lib/utils";
import type { SidebarState } from "../state/hopper-types";
import { RuntimeStatusPanel, summarizeRuntimeStatus } from "./runtime-status";
import { Tooltip } from "./ui/tooltip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export type Tone = "ok" | "warn" | "danger" | "muted";

function toneClass(tone: Tone) {
	return {
		ok: "bg-accent",
		warn: "bg-warn animate-pulse",
		danger: "bg-danger",
		muted: "bg-line-strong animate-pulse",
	}[tone];
}

function connectionSummary(state: SidebarState) {
	const status = state.connection.status;
	const label = { connecting: "Connecting", authenticating: "Authenticating", connected: "Connected", disconnected: "Disconnected", error: "Connection failed" }[status];
	const canRetry = status === "disconnected" || status === "error";
	const tone: Tone = status === "connected" ? "ok" : canRetry ? "danger" : "warn";
	return { tone, label, canRetry };
}

function ConnectionCard({ state, onReconnect }: { state: SidebarState; onReconnect(): void }) {
	const { tone, label, canRetry } = connectionSummary(state);
	return (
		<div className="px-2.5 py-2">
			<div className="flex items-start gap-2">
				<span aria-hidden="true" className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", toneClass(tone))} />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium">{label}</p>
					<p className="mt-0.5 text-[11px] leading-4 text-muted">{state.connection.detail}</p>
					<p className="mt-0.5 text-[11px] leading-4 text-muted" aria-live="polite">{state.backendDetail}</p>
				</div>
				{canRetry && (
					<Button size="xs" variant="secondary" onClick={onReconnect}>
						<RefreshCw className="size-3" />
						Retry
					</Button>
				)}
			</div>
		</div>
	);
}

function ProviderCard({ state, connected, onManageProvider }: { state: SidebarState; connected: boolean; onManageProvider(): void }) {
	const authenticated = state.providers.filter((provider) => provider.authenticated);
	const selected = state.selectedModel?.provider ?? authenticated[0]?.id ?? null;
	const selectedAuthenticated = state.providers.some((provider) => provider.id === selected && provider.authenticated);
	return (
		<div className="px-2.5 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-medium uppercase tracking-wider text-muted">Provider</span>
				<Badge variant={selectedAuthenticated ? "accent" : authenticated.length ? "neutral" : "warn"} dot>
					{selectedAuthenticated ? "Signed in" : authenticated.length ? "Available" : "Not set up"}
				</Badge>
			</div>
			<div className="mt-1.5 flex items-center justify-between gap-2">
				<span className="truncate text-xs font-medium">{selected ? providerLabel(selected, state.providers) : "None connected"}</span>
				<Button size="xs" variant="ghost" className="-mr-1" disabled={!connected} onClick={onManageProvider}>
					Manage
				</Button>
			</div>
		</div>
	);
}

export type SidebarProps = {
	token: string;
	threads?: ReactNode;
	newThreadDisabled?: boolean;
	connected: boolean;
	collapsed: boolean;
	onCollapsedChange(collapsed: boolean): void;
	mobileOpen: boolean;
	onMobileOpenChange(open: boolean): void;
	onNewSession(): void;
	onManageProvider(): void;
	onManageSkills(): void;
	onViewTools(): void;
	onReconnect(): void;
	/**
	 * Replaces the single-runtime status panel when the host tracks several Rhino instances.
	 * The summary drives the status dot on the collapsed rail.
	 */
	rhino?: { summary: { tone: Tone; text: string }; panel: ReactNode };
};

export function Sidebar({
	token,
	threads,
	newThreadDisabled,
	connected,
	collapsed,
	onCollapsedChange,
	mobileOpen,
	onMobileOpenChange,
	onNewSession,
	onManageProvider,
	onManageSkills,
	onViewTools,
	onReconnect,
	rhino,
}: SidebarProps) {
	const state = useHopperStore(useShallow((state) => ({
		connection: state.connection, backendDetail: state.backendDetail,
		providers: state.providers, selectedModel: state.selectedModel,
		runtimeStatus: state.runtimeStatus, runtimeStatusError: state.runtimeStatusError,
	})));
	const { refresh: onRefreshRuntime, refreshing: runtimeRefreshing } = useRuntimeStatus(token, connected && !rhino);
	const container = useRef<HTMLElement>(null);

	// Mobile settings sheet closes on Escape and on taps outside the sidebar.
	useEffect(() => {
		if (!mobileOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onMobileOpenChange(false);
		};
		const onPointer = (event: PointerEvent) => {
			if (container.current && !container.current.contains(event.target as Node)) onMobileOpenChange(false);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onPointer);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointer);
		};
	}, [mobileOpen, onMobileOpenChange]);

	const runtime = rhino?.summary ?? summarizeRuntimeStatus(state.runtimeStatus, state.runtimeStatusError);
	const connection = connectionSummary(state);

	const panels = (
		<>
			<ProviderCard state={state} connected={connected} onManageProvider={onManageProvider} />
			<Button variant="ghost" size="sm" className="justify-start" disabled={!connected} onClick={onManageSkills}>
				<BookOpen className="size-3.5" />Skills & Markdown
			</Button>
			<Button variant="ghost" size="sm" className="justify-start" disabled={!connected} onClick={onViewTools}>
				<Wrench className="size-3.5" />Agent tools
			</Button>
			{rhino?.panel ?? <RuntimeStatusPanel status={state.runtimeStatus} error={state.runtimeStatusError} onRefresh={onRefreshRuntime} refreshing={runtimeRefreshing} />}
			<ConnectionCard state={state} onReconnect={onReconnect} />
		</>
	);

	return (
		<aside
			ref={container}
			aria-label="HopperCode controls"
			className={cn(
				"relative z-20 flex shrink-0 flex-col border-b border-line bg-panel lg:h-full lg:border-b-0 lg:border-r lg:transition-[width] lg:duration-200",
				collapsed ? "lg:w-12" : "lg:w-[248px]",
			)}
		>
			{/* Mobile top bar */}
			<div className="flex items-center gap-2 px-3 py-2 lg:hidden">
				<span className="flex flex-1 items-center gap-2 text-[13px] font-semibold tracking-tight"><span><span className="text-accent-hover">Hopper</span>Code</span></span>
				<Button size="sm" variant="secondary" disabled={!connected || newThreadDisabled} title={newThreadDisabled ? "Stop the running thread first" : "New thread"} onClick={onNewSession} aria-label="New thread">
					<Plus className="size-3.5" />
					<span className="max-sm:hidden">New thread</span>
				</Button>
				<Button
					size="icon-sm"
					variant={mobileOpen ? "default" : "ghost"}
					aria-expanded={mobileOpen}
					aria-controls="mobile-settings-panel"
					aria-label={mobileOpen ? "Close settings" : "Open settings"}
					onClick={() => onMobileOpenChange(!mobileOpen)}
				>
					{mobileOpen ? <X className="size-4" /> : <Settings2 className="size-4" />}
				</Button>
			</div>
			<div
				id="mobile-settings-panel"
				className={cn(
					"lg:hidden",
					mobileOpen
						? "absolute left-2 right-2 top-[calc(100%-1px)] z-30 grid max-h-[min(70vh,520px)] gap-2 overflow-y-auto rounded-md border border-line-strong bg-panel p-2 shadow-pop animate-fade-in"
						: "hidden",
				)}
			>
				{threads}
				{panels}
			</div>

			{/* Desktop: collapsed rail */}
			{collapsed ? (
				<div className="hidden flex-1 flex-col items-center gap-1 py-2 lg:flex">
					<Button size="icon-sm" variant="ghost" onClick={() => onCollapsedChange(false)} aria-label="Expand sidebar" title="Expand sidebar">
						<PanelLeftOpen className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected || newThreadDisabled} title={newThreadDisabled ? "Stop the running thread first" : "New thread"} onClick={onNewSession} aria-label="New thread">
						<Plus className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected} onClick={onManageProvider} aria-label="Manage provider" title="Manage provider">
						<KeyRound className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected} onClick={onManageSkills} aria-label="Skills & Markdown" title="Skills & Markdown">
						<BookOpen className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected} onClick={onViewTools} aria-label="Agent tools" title="Agent tools">
						<Wrench className="size-4" />
					</Button>
					<div className="mt-auto grid pb-2" aria-label="Status">
						<Tooltip content={`${rhino ? "Rhino instances" : "Rhino runtime"}: ${runtime.text}`}>
							<span tabIndex={0} role="img" aria-label={`${rhino ? "Rhino instances" : "Rhino runtime"}: ${runtime.text}`} className="flex size-7 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
								<span aria-hidden="true" className={cn("size-1.5 rounded-full", toneClass(runtime.tone))} />
							</span>
						</Tooltip>
						<Tooltip content={`Host connection: ${connection.label}`}>
							<span tabIndex={0} role="img" aria-label={`Host connection: ${connection.label}`} className="flex size-7 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
								<span aria-hidden="true" className={cn("size-1.5 rounded-full", toneClass(connection.tone))} />
							</span>
						</Tooltip>
					</div>
				</div>
			) : (
				<div className="hidden min-h-0 flex-1 flex-col lg:flex">
					<div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
						<span className="flex flex-1 items-center gap-2 text-[13px] font-semibold tracking-tight"><span><span className="text-accent-hover">Hopper</span>Code</span></span>
						<Button size="icon-sm" variant="ghost" className="-mr-1.5" onClick={() => onCollapsedChange(true)} aria-label="Collapse sidebar" title="Collapse sidebar">
							<PanelLeftClose className="size-4" />
						</Button>
					</div>
					<div className="px-3">
						<Button className="w-full justify-start" variant="secondary" size="sm" disabled={!connected || newThreadDisabled} title={newThreadDisabled ? "Stop the running thread first" : "New thread"} onClick={onNewSession}>
							<Plus className="size-3.5" />
							New thread
						</Button>
					</div>
					{threads}
					<div className="grid max-h-[45%] shrink-0 gap-2 overflow-y-auto p-3">{panels}</div>
				</div>
			)}
		</aside>
	);
}
