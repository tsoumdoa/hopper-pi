import { ExternalLink, KeyRound, Loader2, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { providerLabel } from "../lib/utils";
import type { AuthFlow, ProviderSummary } from "../state/hopper-types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKicker, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const FALLBACK_PROVIDERS: ProviderSummary[] = [
	{ id: "anthropic", name: "Anthropic", authenticated: false },
	{ id: "openai", name: "OpenAI", authenticated: false },
	{ id: "openai-codex", name: "OpenAI Codex", authenticated: false },
	{ id: "google", name: "Google", authenticated: false },
];

export type ProviderDialogProps = {
	open: boolean;
	onOpenChange(open: boolean): void;
	providers: ProviderSummary[];
	/** Provider backing the current model, used as the default selection. */
	currentProvider: string | null;
	auth: AuthFlow;
	onLogin(provider: string, authType: "api_key" | "oauth", apiKey?: string): boolean;
	onLogout(provider: string): void;
	onResetAuth(): void;
};

export function ProviderDialog({ open, onOpenChange, providers, currentProvider, auth, onLogin, onLogout, onResetAuth }: ProviderDialogProps) {
	const options = providers.length ? providers : FALLBACK_PROVIDERS;
	const [provider, setProvider] = useState<string>("");
	const [authType, setAuthType] = useState<"api_key" | "oauth">("api_key");
	const [apiKey, setApiKey] = useState("");
	const [validation, setValidation] = useState<string | null>(null);

	// Each time the dialog opens, start from the session's provider with a clean form.
	// Only `open` drives this; the other values are read once at that moment.
	const latest = useRef({ currentProvider, options, onResetAuth });
	latest.current = { currentProvider, options, onResetAuth };
	useEffect(() => {
		if (!open) return;
		const { currentProvider: current, options: items, onResetAuth: reset } = latest.current;
		setProvider(current ?? items.find((item) => item.authenticated)?.id ?? items[0]?.id ?? "");
		setApiKey("");
		setValidation(null);
		reset();
	}, [open]);

	const selected = options.find((item) => item.id === provider) ?? options[0];
	const selectedId = selected?.id ?? "";
	const selectedName = providerLabel(selectedId, options);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!selectedId) return;
		if (authType === "api_key" && !apiKey.trim()) {
			setValidation("Enter an API key.");
			return;
		}
		setValidation(null);
		if (onLogin(selectedId, authType, authType === "api_key" ? apiKey.trim() : undefined)) setApiKey("");
	};

	const error = validation ?? auth.error;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent aria-describedby="provider-dialog-description">
				<DialogHeader>
					<DialogKicker>Private Hopper settings</DialogKicker>
					<DialogTitle>Model provider</DialogTitle>
					<DialogDescription id="provider-dialog-description">
						Credentials use the global Pi auth store by default. Hopper keeps sessions and other settings separate.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<div className="grid gap-1.5">
						<div className="flex items-center justify-between">
							<Label htmlFor="provider-select">Provider</Label>
							{selected && (
								<Badge variant={selected.authenticated ? "accent" : "neutral"} dot>
									{selected.authenticated ? "Signed in" : "Not signed in"}
								</Badge>
							)}
						</div>
						<Select value={selectedId} onValueChange={setProvider} disabled={auth.busy}>
							<SelectTrigger id="provider-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{options.map((item) => (
									<SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="auth-type-select">Sign-in method</Label>
						<Select value={authType} onValueChange={(value) => setAuthType(value as "api_key" | "oauth")} disabled={auth.busy}>
							<SelectTrigger id="auth-type-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="api_key">API key</SelectItem>
								<SelectItem value="oauth">Browser sign-in</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{authType === "api_key" && (
						<div className="grid gap-1.5">
							<Label htmlFor="api-key-input">API key</Label>
							<Input
								id="api-key-input"
								type="password"
								autoComplete="off"
								spellCheck={false}
								value={apiKey}
								disabled={auth.busy}
								onChange={(event) => {
									setApiKey(event.target.value);
									if (validation) setValidation(null);
								}}
								placeholder={`Paste a ${selectedName} API key`}
								aria-invalid={Boolean(validation) || undefined}
							/>
						</div>
					)}

					{auth.notice && (
						<div role="status" className="flex items-start gap-2 rounded-lg border border-accent/20 bg-accent-soft px-3 py-2.5 text-xs text-accent">
							{auth.busy && !auth.url ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <KeyRound className="mt-0.5 size-3.5 shrink-0" />}
							<div className="min-w-0 flex-1">
								<p className="leading-relaxed">{auth.notice}</p>
								{auth.url && (
									<a className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2" href={auth.url} target="_blank" rel="noreferrer noopener">
										{auth.label ?? "Open link"}
										<ExternalLink className="size-3" />
									</a>
								)}
							</div>
						</div>
					)}
					{error && (
						<p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs leading-relaxed text-danger">{error}</p>
					)}

					<DialogFooter className="mt-1 justify-between">
						<Button type="button" variant="destructive" size="sm" disabled={!selected?.authenticated || auth.busy} onClick={() => onLogout(selectedId)}>
							<LogOut className="size-3.5" />
							Log out
						</Button>
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
							<Button type="submit" disabled={auth.busy || !selectedId}>
								{auth.busy && <Loader2 className="size-4 animate-spin" />}
								{authType === "oauth" ? "Sign in" : "Connect"}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
