import { FlaskConical, Power } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer, type ComposerHandle } from "./components/composer";
import { ConfirmDialog, type ConfirmRequest } from "./components/confirm-dialog";
import { ConnectionBanner } from "./components/connection-banner";
import { Conversation } from "./components/conversation";
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
	const [mode, setMode] = useState<SendMode>("prompt");
	const [providerOpen, setProviderOpen] = useState(false);
	const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
	const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
	const composer = useRef<ComposerHandle>(null);

	const streaming = state.session.isStreaming;

	useEffect(() => {
		document.title = state.session.name ? `${state.session.name} · Hopper` : "Hopper";
	}, [state.session.name]);

	// Match the old behaviour: while a turn runs, new text becomes a follow-up unless the
	// user picks otherwise; when it finishes, go back to starting new turns.
	useEffect(() => {
		if (streaming) setMode((current) => (current === "prompt" ? "follow_up" : current));
		else setMode("prompt");
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
				mobileOpen={mobileSettingsOpen}
				onMobileOpenChange={setMobileSettingsOpen}
				onNewSession={newSession}
				onManageProvider={openProvider}
				onSelectModel={selectModel}
				onSelectThinking={(level) => send({ type: "set_thinking", level })}
				onReconnect={reconnect}
				onRefreshRuntime={() => void refreshRuntime()}
				runtimeRefreshing={refreshing}
			/>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex min-h-[56px] shrink-0 items-center justify-between gap-4 border-b border-line bg-canvas/80 px-4 backdrop-blur sm:px-6 lg:px-10">
					<div className="min-w-0">
						<p className="text-[11px] font-medium uppercase tracking-[.12em] text-muted max-sm:hidden">Active conversation</p>
						<h1 className="truncate text-sm font-semibold tracking-tight">{state.session.name}</h1>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{isMockMode && (
							<Badge variant="warn" className="max-sm:hidden">
								<FlaskConical className="size-3" />
								Mock
							</Badge>
						)}
						<StatusPill connectionStatus={state.connection.status} streaming={streaming} workingMessage={state.workingMessage} />
						<Button size="sm" variant="ghost" disabled={!connected} onClick={shutdown} title="Stop the local Hopper host">
							<Power className="size-3.5" />
							<span className="max-sm:hidden">Shut down</span>
						</Button>
					</div>
				</header>
				<ConnectionBanner connection={state.connection} onReconnect={reconnect} />
				<Conversation messages={state.session.messages} connected={connected} onSuggestion={useSuggestion} />
				<Composer
					ref={composer}
					draft={draft}
					onDraftChange={setDraft}
					mode={mode}
					onModeChange={setMode}
					disabled={!connected}
					streaming={streaming}
					onSubmit={submit}
					onAbort={() => send({ type: "abort" })}
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
