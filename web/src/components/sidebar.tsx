import { KeyRound, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn, providerLabel } from "../lib/utils";
import type { HopperState } from "../state/hopper-types";
import { RuntimeStatusPanel, summarizeRuntimeStatus } from "./runtime-status";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function BrandMark({ className }: { className?: string }) {
	return (
		<span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-sm bg-accent text-[13px] font-bold leading-none text-white", className)}>
			H
		</span>
	);
}

type Tone = "ok" | "warn" | "danger" | "muted";

function toneClass(tone: Tone) {
	return {
		ok: "bg-accent",
		warn: "bg-warn animate-pulse",
		danger: "bg-danger",
		muted: "bg-line-strong animate-pulse",
	}[tone];
}

function connectionSummary(state: HopperState): { tone: Tone; label: string; canRetry: boolean } {
	const status = state.connection.status;
	const label = { connecting: "Connecting", authenticating: "Authenticating", connected: "Connected", disconnected: "Disconnected", error: "Connection failed" }[status];
	const canRetry = status === "disconnected" || status === "error";
	const tone: Tone = status === "connected" ? "ok" : canRetry ? "danger" : "warn";
	return { tone, label, canRetry };
}

function ConnectionCard({ state, onReconnect }: { state: HopperState; onReconnect(): void }) {
	const { tone, label, canRetry } = connectionSummary(state);
	return (
		<div className="rounded-md border border-line bg-surface p-2.5">
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

function ProviderCard({ state, connected, onManageProvider }: { state: HopperState; connected: boolean; onManageProvider(): void }) {
	const authenticated = state.providers.filter((provider) => provider.authenticated);
	const selected = state.selectedModel?.provider ?? authenticated[0]?.id ?? null;
	const selectedAuthenticated = state.providers.some((provider) => provider.id === selected && provider.authenticated);
	return (
		<div className="rounded-md border border-line bg-surface p-2.5">
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
	state: HopperState;
	connected: boolean;
	collapsed: boolean;
	onCollapsedChange(collapsed: boolean): void;
	mobileOpen: boolean;
	onMobileOpenChange(open: boolean): void;
	onNewSession(): void;
	onManageProvider(): void;
	onReconnect(): void;
	onRefreshRuntime(): void;
	runtimeRefreshing: boolean;
};

export function Sidebar({
	state,
	connected,
	collapsed,
	onCollapsedChange,
	mobileOpen,
	onMobileOpenChange,
	onNewSession,
	onManageProvider,
	onReconnect,
	onRefreshRuntime,
	runtimeRefreshing,
}: SidebarProps) {
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

	const runtime = summarizeRuntimeStatus(state.runtimeStatus, state.runtimeStatusError);
	const connection = connectionSummary(state);

	const panels = (
		<>
			<ProviderCard state={state} connected={connected} onManageProvider={onManageProvider} />
			<RuntimeStatusPanel status={state.runtimeStatus} error={state.runtimeStatusError} onRefresh={onRefreshRuntime} refreshing={runtimeRefreshing} />
			<ConnectionCard state={state} onReconnect={onReconnect} />
		</>
	);

	return (
		<aside
			ref={container}
			aria-label="Hopper controls"
			className={cn(
				"relative z-20 flex shrink-0 flex-col border-b border-line bg-panel lg:h-full lg:border-b-0 lg:border-r lg:transition-[width] lg:duration-200",
				collapsed ? "lg:w-12" : "lg:w-[248px]",
			)}
		>
			{/* Mobile top bar */}
			<div className="flex items-center gap-2 px-3 py-2 lg:hidden">
				<BrandMark />
				<span className="flex-1 text-[13px] font-semibold tracking-tight">Hopper</span>
				<Button size="sm" variant="secondary" disabled={!connected} onClick={onNewSession} aria-label="New session">
					<Plus className="size-3.5" />
					<span className="max-sm:hidden">New session</span>
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
				{panels}
			</div>

			{/* Desktop: collapsed rail */}
			{collapsed ? (
				<div className="hidden flex-1 flex-col items-center gap-1 py-2 lg:flex">
					<Button size="icon-sm" variant="ghost" onClick={() => onCollapsedChange(false)} aria-label="Expand sidebar" title="Expand sidebar">
						<PanelLeftOpen className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected} onClick={onNewSession} aria-label="New session" title="New session">
						<Plus className="size-4" />
					</Button>
					<Button size="icon-sm" variant="ghost" disabled={!connected} onClick={onManageProvider} aria-label="Manage provider" title="Manage provider">
						<KeyRound className="size-4" />
					</Button>
					<div className="mt-auto grid gap-2.5 pb-2" aria-label="Status">
						<span title={`Rhino runtime · ${runtime.text}`} aria-label={`Rhino runtime: ${runtime.text}`} role="img" className={cn("size-1.5 rounded-full", toneClass(runtime.tone))} />
						<span title={`Connection · ${connection.label}`} aria-label={`Connection: ${connection.label}`} role="img" className={cn("size-1.5 rounded-full", toneClass(connection.tone))} />
					</div>
				</div>
			) : (
				<div className="hidden min-h-0 flex-1 flex-col lg:flex">
					<div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
						<BrandMark />
						<span className="flex-1 text-[13px] font-semibold tracking-tight">Hopper</span>
						<Button size="icon-sm" variant="ghost" className="-mr-1.5" onClick={() => onCollapsedChange(true)} aria-label="Collapse sidebar" title="Collapse sidebar">
							<PanelLeftClose className="size-4" />
						</Button>
					</div>
					<div className="px-3">
						<Button className="w-full justify-start" variant="secondary" size="sm" disabled={!connected} onClick={onNewSession}>
							<Plus className="size-3.5" />
							New session
						</Button>
					</div>
					<div className="mt-auto grid gap-2 overflow-y-auto p-3">{panels}</div>
				</div>
			)}
		</aside>
	);
}
