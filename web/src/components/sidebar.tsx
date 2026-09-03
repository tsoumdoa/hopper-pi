import { Plus, RefreshCw, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn, providerLabel, thinkingLabel } from "../lib/utils";
import type { HopperState } from "../state/hopper-types";
import { RuntimeStatusPanel } from "./runtime-status";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./ui/select";

const FALLBACK_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function BrandMark({ className }: { className?: string }) {
	return (
		<span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-base font-bold text-white shadow-sm", className)}>
			H
		</span>
	);
}

function ConnectionCard({ state, onReconnect }: { state: HopperState; onReconnect(): void }) {
	const status = state.connection.status;
	const label = { connecting: "Connecting", authenticating: "Authenticating", connected: "Connected", disconnected: "Disconnected", error: "Connection failed" }[status];
	const canRetry = status === "disconnected" || status === "error";
	return (
		<div className="rounded-xl border border-line bg-surface p-3 shadow-card">
			<div className="flex items-start gap-2.5">
				<span
					aria-hidden="true"
					className={cn(
						"mt-1.5 size-2 shrink-0 rounded-full",
						status === "connected" && "bg-accent",
						(status === "connecting" || status === "authenticating") && "bg-warn animate-pulse",
						canRetry && "bg-danger",
					)}
				/>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold">{label}</p>
					<p className="mt-0.5 text-[11px] leading-4 text-muted">{state.connection.detail}</p>
					<p className="mt-1 text-[11px] leading-4 text-muted" aria-live="polite">{state.backendDetail}</p>
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

export type SidebarProps = {
	state: HopperState;
	connected: boolean;
	mobileOpen: boolean;
	onMobileOpenChange(open: boolean): void;
	onNewSession(): void;
	onManageProvider(): void;
	onSelectModel(value: string): void;
	onSelectThinking(level: string): void;
	onReconnect(): void;
	onRefreshRuntime(): void;
	runtimeRefreshing: boolean;
};

export function Sidebar({
	state,
	connected,
	mobileOpen,
	onMobileOpenChange,
	onNewSession,
	onManageProvider,
	onSelectModel,
	onSelectThinking,
	onReconnect,
	onRefreshRuntime,
	runtimeRefreshing,
}: SidebarProps) {
	const container = useRef<HTMLElement>(null);
	const groupedModels = useMemo(() => {
		const groups = new Map<string, HopperState["models"]>();
		for (const model of state.models) {
			const list = groups.get(model.provider) ?? [];
			list.push(model);
			groups.set(model.provider, list);
		}
		return [...groups.entries()];
	}, [state.models]);
	const thinkingLevels = state.availableThinkingLevels.length ? state.availableThinkingLevels : FALLBACK_THINKING_LEVELS;
	const authenticatedProviders = state.providers.filter((provider) => provider.authenticated);
	const selectedProvider = state.selectedModel?.provider ?? authenticatedProviders[0]?.id ?? null;
	const selectedProviderAuthenticated = state.providers.some((provider) => provider.id === selectedProvider && provider.authenticated);
	const modelValue = state.selectedModel ? `${state.selectedModel.provider}/${state.selectedModel.id}` : "";

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

	const settings = (
		<>
			<section aria-labelledby="agent-settings-title" className="grid gap-3">
				<h2 id="agent-settings-title" className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Agent</h2>
				<div className="grid gap-1.5">
					<Label htmlFor="model-select">Model</Label>
					<Select disabled={!connected || !state.models.length} value={modelValue} onValueChange={onSelectModel}>
						<SelectTrigger id="model-select">
							<SelectValue placeholder={connected && !state.models.length ? "No authenticated models" : "Waiting for models"} />
						</SelectTrigger>
						<SelectContent>
							{groupedModels.map(([provider, models]) => (
								<SelectGroup key={provider}>
									<SelectLabel>{providerLabel(provider, state.providers)}</SelectLabel>
									{models.map((model) => (
										<SelectItem key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
											{model.name ?? model.id}
										</SelectItem>
									))}
								</SelectGroup>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="thinking-select">Thinking</Label>
					<Select disabled={!connected || !state.models.length} value={state.thinkingLevel} onValueChange={onSelectThinking}>
						<SelectTrigger id="thinking-select">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{thinkingLevels.map((level) => (
								<SelectItem key={level} value={level}>{thinkingLabel(level)}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</section>

			<section aria-labelledby="provider-title" className="rounded-xl border border-line bg-surface p-3 shadow-card">
				<div className="flex items-center justify-between gap-2">
					<h2 id="provider-title" className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Provider</h2>
					<Badge variant={selectedProviderAuthenticated ? "accent" : authenticatedProviders.length ? "neutral" : "warn"} dot>
						{selectedProviderAuthenticated ? "Connected" : authenticatedProviders.length ? "Available" : "Not configured"}
					</Badge>
				</div>
				<p className="mt-2 text-xs leading-relaxed text-ink-soft">
					{selectedProvider
						? `${providerLabel(selectedProvider, state.providers)} is selected for this session.${authenticatedProviders.length > 1 ? ` ${authenticatedProviders.length} providers are signed in.` : ""}`
						: "Connect a model provider to start working with Hopper."}
				</p>
				<Button className="mt-3 w-full" variant="secondary" size="sm" disabled={!connected} onClick={onManageProvider}>
					Manage provider
				</Button>
			</section>
		</>
	);

	return (
		<aside
			ref={container}
			aria-label="Hopper controls"
			className="relative z-20 flex shrink-0 flex-col gap-3 border-b border-line bg-canvas/95 p-3 backdrop-blur lg:h-full lg:w-[288px] lg:gap-5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4"
		>
			<div className="flex items-center gap-3">
				<BrandMark />
				<div className="min-w-0 flex-1">
					<p className="text-[15px] font-semibold tracking-tight">Hopper</p>
					<p className="truncate text-[11px] text-muted">Private agent for Rhino &amp; Grasshopper</p>
				</div>
				<div className="flex gap-1.5 lg:hidden">
					<Button size="sm" disabled={!connected} onClick={onNewSession} aria-label="New session">
						<Plus className="size-4" />
						<span className="max-sm:hidden">New session</span>
					</Button>
					<Button
						size="icon-sm"
						variant={mobileOpen ? "default" : "secondary"}
						aria-expanded={mobileOpen}
						aria-controls="mobile-settings-panel"
						aria-label={mobileOpen ? "Close settings" : "Open settings"}
						onClick={() => onMobileOpenChange(!mobileOpen)}
					>
						{mobileOpen ? <X className="size-4" /> : <Settings2 className="size-4" />}
					</Button>
				</div>
			</div>

			<Button className="hidden w-full lg:flex" size="lg" disabled={!connected} onClick={onNewSession}>
				<Plus className="size-4" />
				New session
			</Button>

			<div id="mobile-settings-panel" className={cn("grid gap-4 lg:contents", mobileOpen ? "animate-fade-in" : "max-lg:hidden")}>
				{settings}
				<div className="lg:hidden">
					<ConnectionCard state={state} onReconnect={onReconnect} />
				</div>
			</div>

			<div className="mt-auto hidden gap-3 lg:grid">
				<RuntimeStatusPanel status={state.runtimeStatus} error={state.runtimeStatusError} onRefresh={onRefreshRuntime} refreshing={runtimeRefreshing} />
				<ConnectionCard state={state} onReconnect={onReconnect} />
				<p className="px-1 text-[11px] leading-4 text-muted">This page talks only to the Hopper host running on this computer.</p>
			</div>
		</aside>
	);
}
