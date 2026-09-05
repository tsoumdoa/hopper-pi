import { FlaskConical, Power } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer, type ComposerHandle } from "./components/composer";
import { ConfirmDialog, type ConfirmRequest } from "./components/confirm-dialog";
import { ConnectionBanner } from "./components/connection-banner";
import { Conversation } from "./components/conversation";
import { ModelControls } from "./components/model-picker";
import { ProviderDialog } from "./components/provider-dialog";
import { Sidebar } from "./components/sidebar";
import { ToastRegion } from "./components/toasts";
import { UiRequestDialog } from "./components/ui-request-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { useHopperConnection } from "./hooks/use-hopper-connection";
import { useRuntimeStatus } from "./hooks/use-runtime-status";
import { providerLabel } from "./lib/utils";
import type { SendMode } from "./state/hopper-types";

const SIDEBAR_KEY = "hopper.sidebar.collapsed";

function readCollapsed() {
	try {
		return window.localStorage.getItem(SIDEBAR_KEY) === "1";
	} catch {
		return false;
	}
}

function StatusPill({ connectionStatus, streaming, workingMessage }: { connectionStatus: string; streaming: boolean; workingMessage: string | null }) {
	if (connectionStatus !== "connected") {
		const label = { connecting: "Connecting", authenticating: "Authenticating", disconnected: "Offline", error: "Offline" }[connectionStatus] ?? "Starting";
		return <Badge variant={connectionStatus === "disconnected" || connectionStatus === "error" ? "danger" : "warn"} dot pulse={connectionStatus !== "disconnected"}>{label}</Badge>;
	}
	if (streaming) return <Badge variant="accent" dot pulse className="max-w-[240px] [&>span:last-child]:truncate"><span>{workingMessage || "Working"}</span></Badge>;
	return <Badge dot>Ready</Badge>;
}

export function App() {
	const { state, dispatch, token, send, prompt, login, logout, reconnect, isMockMode } = useHopperConnection();
	const connected = state.connection.status === "connected";
	const { refresh: refreshRuntime, refreshing } = useRuntimeStatus(token, connected, dispatch, isMockMode);

	const [draft, setDraft] = useState("");
	// Explicit delivery choice made while a turn runs; null means the default for the current state.
	const [modeOverride, setModeOverride] = useState<SendMode | null>(null);
	const [providerOpen, setProviderOpen] = useState(false);
	const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
	const composer = useRef<ComposerHandle>(null);

	const streaming = state.session.isStreaming;
	// While a turn runs, new text becomes a follow-up unless the user picks otherwise;
	// when it finishes, go back to starting new turns.
	const mode: SendMode = modeOverride ?? (streaming ? "follow_up" : "prompt");

	useEffect(() => {
		document.title = state.session.name ? `${state.session.name} · Hopper` : "Hopper";
	}, [state.session.name]);

	useEffect(() => {
		try {
			window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
		} catch {
			// Storage may be unavailable; the preference is only a convenience.
		}
	}, [sidebarCollapsed]);

	useEffect(() => {
		if (!streaming) setModeOverride(null);
	}, [streaming]);

	// A completed sign-in closes the provider dialog.
	useEffect(() => {
		if (state.auth.completedCount > 0) setProviderOpen(false);
	}, [state.auth.completedCount]);

	// Focus the composer when the host becomes ready or a new session starts.
	useEffect(() => {
		if (connected) composer.current?.focus();
	}, [connected, state.session.id]);

	const submit = () => {
		const text = draft.trim();
		if (!text) return;
		if (prompt(text, mode)) setDraft("");
	};

	const newSession = () => {
		const start = () => send({ type: "new_session" });
		if (streaming) {
			setConfirm({
				title: "Start a new session?",
				description: "Hopper is still working on the current response. Starting a new session stops it and clears this conversation.",
				confirmLabel: "New session",
				action: start,
			});
			return;
		}
		start();
	};

	const shutdown = () =>
		setConfirm({
			title: "Shut down the Hopper host?",
			description: "This stops the local Hopper host and closes this page's connection. Rhino can start it again with _HopperCode.",
			confirmLabel: "Shut down",
			destructive: true,
			action: () => send({ type: "shutdown" }),
		});

	const requestLogout = (provider: string) =>
		setConfirm({
			title: `Log out of ${providerLabel(provider, state.providers)}?`,
			description: "Hopper forgets the saved credential for this provider. Models from it stop being available until you sign in again.",
			confirmLabel: "Log out",
			destructive: true,
			action: () => logout(provider),
		});

	const selectModel = (value: string) => {
		const [provider, ...rest] = value.split("/");
		const id = rest.join("/");
		if (provider && id) send({ type: "set_model", provider, id });
	};

	const openProvider = useCallback(() => {
		setMobileSettingsOpen(false);
		setProviderOpen(true);
	}, []);

	const useSuggestion = (text: string) => {
		setDraft(text);
		composer.current?.focus();
	};

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-canvas lg:flex-row">
			<a className="skip-link" href="#composer-input">Skip to message</a>
			<Sidebar
				state={state}
				connected={connected}
				collapsed={sidebarCollapsed}
				onCollapsedChange={setSidebarCollapsed}
				mobileOpen={mobileSettingsOpen}
				onMobileOpenChange={setMobileSettingsOpen}
				onNewSession={newSession}
				onManageProvider={openProvider}
				onReconnect={reconnect}
				onRefreshRuntime={() => void refreshRuntime()}
				runtimeRefreshing={refreshing}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
					<h1 className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight">{state.session.name}</h1>
					{isMockMode && (
						<Badge variant="warn" className="max-sm:hidden">
							<FlaskConical className="size-3" />
							Mock
						</Badge>
					)}
					<StatusPill connectionStatus={state.connection.status} streaming={streaming} workingMessage={state.workingMessage} />
					<Button size="icon-sm" variant="ghost" className="-mr-1.5" disabled={!connected} onClick={shutdown} aria-label="Shut down the Hopper host" title="Shut down the Hopper host">
						<Power className="size-3.5" />
					</Button>
				</header>
				<ConnectionBanner connection={state.connection} onReconnect={reconnect} />
				<Conversation messages={state.session.messages} connected={connected} onSuggestion={useSuggestion} />
				<Composer
					ref={composer}
					draft={draft}
					onDraftChange={setDraft}
					mode={mode}
					onModeChange={setModeOverride}
					disabled={!connected}
					streaming={streaming}
					onSubmit={submit}
					onAbort={() => send({ type: "abort" })}
					controls={
						<ModelControls
							state={state}
							connected={connected}
							onSelectModel={selectModel}
							onSelectThinking={(level) => send({ type: "set_thinking", level })}
							onManageProvider={openProvider}
						/>
					}
				/>
			</main>

			{providerOpen && (
				<ProviderDialog
					onOpenChange={setProviderOpen}
					providers={state.providers}
					currentProvider={state.selectedModel?.provider ?? null}
					auth={state.auth}
					onLogin={login}
					onLogout={requestLogout}
				/>
			)}
			<UiRequestDialog
				request={state.activeUiRequest}
				queued={state.pendingUiRequests.length}
				send={send}
				onResolved={() => dispatch({ type: "ui-request-resolved" })}
			/>
			<ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
			<ToastRegion notices={state.notifications} onDismiss={(id) => dispatch({ type: "dismiss-toast", id })} />
		</div>
	);
}
