import { ExternalLink, KeyRound, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useHopperStore } from "../state/hopper-store-context";
import { providerLabel } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type ProviderDialogProps = {
	onOpenChange(open: boolean): void;
	onLogin(provider: string, authType: "api_key" | "oauth", apiKey?: string): boolean;
	onLogout(provider: string): void;
};

export function ProviderDialog({ onOpenChange, onLogin, onLogout }: ProviderDialogProps) {
	const providers = useHopperStore((state) => state.providers);
	const currentProvider = useHopperStore((state) => state.selectedModel?.provider ?? null);
	const auth = useHopperStore((state) => state.auth);
	const initialProvider = providers.find((item) => item.id === auth.provider)
		?? providers.find((item) => item.id === currentProvider)
		?? providers.find((item) => item.authenticated)
		?? providers[0];
	const [provider, setProvider] = useState(initialProvider?.id ?? "");
	const [authType, setAuthType] = useState<"api_key" | "oauth">(initialProvider?.authMethods[0]?.type ?? "api_key");
	const [apiKey, setApiKey] = useState("");
	const [validation, setValidation] = useState<string | null>(null);

	const selectProvider = (id: string) => {
		setProvider(id);
		setAuthType(providers.find((item) => item.id === id)?.authMethods[0]?.type ?? "api_key");
		setApiKey("");
		setValidation(null);
	};

	const selected = providers.find((item) => item.id === provider) ?? providers[0];
	const selectedId = selected?.id ?? "";
	const selectedName = providerLabel(selectedId, providers);
	const selectedMethod = selected?.authMethods.find((method) => method.type === authType)
		?? selected?.authMethods[0];
	const selectedAuthType = selectedMethod?.type;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!selectedId || !selectedAuthType) return;
		if (selectedAuthType === "api_key" && !apiKey.trim()) {
			setValidation("Enter an API key.");
			return;
		}
		setValidation(null);
		if (onLogin(selectedId, selectedAuthType, selectedAuthType === "api_key" ? apiKey.trim() : undefined)) setApiKey("");
	};

	const currentAuth = auth.provider === selectedId ? auth : null;
	const error = validation ?? currentAuth?.error;

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent aria-describedby="provider-dialog-description">
				<DialogHeader>
					<DialogTitle>Model providers</DialogTitle>
					<DialogDescription id="provider-dialog-description">
						Credentials are saved in the shared Pi auth store.
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
						<Select value={selectedId} onValueChange={selectProvider} disabled={auth.busy}>
							<SelectTrigger id="provider-select">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{providers.map((item) => (
									<SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{selected?.authMethods.length ? (
						<div className="grid gap-1.5">
							<Label htmlFor={selected.authMethods.length > 1 ? "auth-type-select" : undefined}>Sign-in method</Label>
							{selected.authMethods.length > 1 ? (
								<Select value={selectedAuthType} onValueChange={(value) => setAuthType(value as "api_key" | "oauth")} disabled={auth.busy}>
									<SelectTrigger id="auth-type-select">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{selected.authMethods.map((method) => (
											<SelectItem key={method.type} value={method.type}>{method.label}</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<p className="rounded-sm border border-line bg-surface-muted px-2.5 py-1.5 text-[13px] text-ink-soft">{selectedMethod?.label}</p>
							)}
						</div>
					) : (
						<p className="rounded-sm border border-line bg-surface-muted px-2.5 py-2 text-xs leading-relaxed text-ink-soft">
							{selected ? `${selected.name} must be configured outside Hopper.` : "No providers are available."}
						</p>
					)}
					{selectedAuthType === "api_key" && (
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

					{currentAuth?.notice && (
						<div role="status" className="flex items-start gap-2 rounded-sm border border-accent/20 bg-accent-soft px-2.5 py-2 text-xs text-accent">
							{currentAuth.busy && !currentAuth.url ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <KeyRound className="mt-0.5 size-3.5 shrink-0" />}
							<div className="min-w-0 flex-1">
								<p className="leading-relaxed">{currentAuth.notice}</p>
								{currentAuth.url && (
									<a className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2" href={currentAuth.url} target="_blank" rel="noreferrer noopener">
										{currentAuth.label ?? "Open link"}
										<ExternalLink className="size-3" />
									</a>
								)}
							</div>
						</div>
					)}
					{error && (
						<p role="alert" className="rounded-sm border border-danger/20 bg-danger-soft px-2.5 py-2 text-xs leading-relaxed text-danger">{error}</p>
					)}

					<DialogFooter className="mt-1 justify-between">
						<Button type="button" variant="destructive" size="sm" disabled={!selected?.authenticated || auth.busy} onClick={() => onLogout(selectedId)}>
							<LogOut className="size-3.5" />
							Log out
						</Button>
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
							<Button type="submit" disabled={auth.busy || !selectedId || !selectedAuthType}>
								{auth.busy && <Loader2 className="size-4 animate-spin" />}
								{selectedAuthType === "oauth" ? "Sign in" : "Connect"}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
