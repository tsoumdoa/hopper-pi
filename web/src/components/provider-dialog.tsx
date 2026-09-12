import { ArrowLeft, Check, ChevronRight, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHopperStore } from "../state/hopper-store-context";
import type { CustomProviderInput } from "../../../src/host/provider-config.js";
import type { ProviderSummary } from "../state/hopper-types";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { RequestDialog } from "./ui-request-dialog";

export type ProviderDialogProps = {
	onOpenChange(open: boolean): void;
	onLogin(provider: string, authType: "api_key" | "oauth", apiKey?: string): boolean;
	onLogout(provider: string): void;
	onAddProvider(config: CustomProviderInput): boolean;
	onRefresh(provider: string): boolean;
	onCancel(): void;
	onSelectModel(provider: string, id: string): boolean;
	onAuthResponse(requestId: string, value: string | boolean | null): boolean;
	initialView?: "overview" | "catalog";
};

export function credentialDescription(provider: ProviderSummary): string {
	if (!provider.authenticated) return "Not configured";
	if (provider.credentialSource === "stored") return "Shared Pi credentials";
	if (provider.credentialSource === "environment") return provider.credentialLabel ?? "From environment";
	if (provider.credentialSource?.startsWith("models_json")) return "From model configuration";
	return "Credentials configured";
}

export function ProviderDialog(props: ProviderDialogProps) {
	const providers = useHopperStore((s) => s.providers);
	const models = useHopperStore((s) => s.models);
	const selectedModel = useHopperStore((s) => s.selectedModel);
	const auth = useHopperStore((s) => s.auth);
	const request = useHopperStore((s) => s.activeUiRequest);
	// Reconnecting resets auth state, but Pi can still be waiting for this prompt.
	const setupPending = auth.busy || request?.kind === "auth";
	const resolveRequest = useHopperStore((s) => s.actions.resolveUiRequest);
	const resetAuth = useHopperStore((s) => s.actions.resetAuth);
	const [view, setView] = useState<"overview" | "catalog" | "setup" | "custom" | "success">(
		setupPending ? "setup" : (props.initialView ?? "overview"),
	);
	const [providerId, setProviderId] = useState(auth.provider ?? "");
	const [search, setSearch] = useState("");
	const [authType, setAuthType] = useState<"api_key" | "oauth">("api_key");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [modelId, setModelId] = useState("");
	const [checkedOnly, setCheckedOnly] = useState(false);
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [api, setApi] = useState<CustomProviderInput["api"]>("openai-completions");
	const [modelIds, setModelIds] = useState("");
	const [noAuth, setNoAuth] = useState(false);
	const [contextWindow, setContextWindow] = useState("");
	const [maxTokens, setMaxTokens] = useState("");
	const [reasoning, setReasoning] = useState(false);
	const [images, setImages] = useState(false);
	const completed = useRef(auth.completedCount);
	const submitted = useRef(setupPending);
	const provider = providers.find((p) => p.id === providerId);
	const providerModels = models.filter((m) => m.provider === providerId);
	const chosenModel = providerModels.some((m) => m.id === modelId) ? modelId : (providerModels[0]?.id ?? "");
	const configured = providers.filter((p) => p.authenticated);
	const currentAuth = auth.provider === providerId || auth.provider === "" ? auth : null;

	useEffect(() => {
		if (auth.completedCount !== completed.current) {
			completed.current = auth.completedCount;
			if (submitted.current) {
				setView("success");
				submitted.current = false;
			}
		}
	}, [auth.completedCount]);

	const navigate = (next: typeof view) => {
		if (setupPending) return;
		setApiKey("");
		setError(null);
		resetAuth();
		setView(next);
	};
	const chooseProvider = (p: ProviderSummary) => {
		if (setupPending) return;
		navigate("setup");
		setProviderId(p.id);
		setModelId("");
		setAuthType(p.authMethods.find((m) => m.type === "oauth")?.type ?? p.authMethods[0]?.type ?? "api_key");
	};
	const refresh = () => {
		setCheckedOnly(true);
		submitted.current = view !== "overview";
		props.onRefresh(providerId);
	};
	const close = () => {
		if (setupPending) props.onCancel();
		props.onOpenChange(false);
	};
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setCheckedOnly(false);
		if (view === "custom") {
			const id = `custom-${name
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")}`;
			if (providers.some((p) => p.id === id)) {
				setError("A provider with this name already exists.");
				return;
			}
			setProviderId(id);
			submitted.current = true;
			if (
				props.onAddProvider({
					id,
					baseUrl: baseUrl.trim(),
					api,
					modelIds: modelIds
						.split(/\n|,/)
						.map((s) => s.trim())
						.filter(Boolean),
					noAuth,
					...(contextWindow ? { contextWindow: Number(contextWindow) } : {}),
					...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
					...(reasoning ? { reasoning: true } : {}),
					...(images ? { images: true } : {}),
					...(!noAuth ? { apiKey: apiKey.trim() } : {}),
				})
			)
				setApiKey("");
		} else {
			submitted.current = true;
			if (
				props.onLogin(providerId, authType, authType === "api_key" ? apiKey.trim() || undefined : undefined)
			)
				setApiKey("");
		}
	};
	const modelPicker =
		providerModels.length > 0 ? (
			<div className="grid gap-2">
				<Label htmlFor="provider-model">Model</Label>
				<Select value={chosenModel} onValueChange={setModelId}>
					<SelectTrigger id="provider-model">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{providerModels.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name ?? m.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					disabled={setupPending}
					onClick={() => {
						if (props.onSelectModel(providerId, chosenModel)) props.onOpenChange(false);
					}}
				>
					Use this model
				</Button>
				{selectedModel && (
					<p className="text-xs text-muted">Your current model stays selected until you choose another.</p>
				)}
			</div>
		) : null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent>
				<DialogHeader>
					{view !== "overview" && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="mb-1 w-fit -ml-2"
							disabled={setupPending}
							onClick={() => navigate(view === "setup" || view === "custom" ? "catalog" : "overview")}
						>
							<ArrowLeft className="size-3.5" />
							Back
						</Button>
					)}
					<DialogTitle>
						{view === "overview"
							? "Model providers"
							: view === "catalog"
								? "Add provider"
								: view === "custom"
									? "Custom provider"
									: view === "success"
										? checkedOnly
											? "Provider checked"
											: "Provider configured"
										: (provider?.name ?? "Provider setup")}
					</DialogTitle>
					<DialogDescription>
						{view === "overview"
							? "Manage the providers available to Hopper."
							: view === "catalog"
								? "Choose a provider supported by Pi, or add your own endpoint."
								: view === "custom"
									? "Connect a local server or a compatible API endpoint."
									: view === "success"
										? "Choose a model to use, or keep your current selection."
										: "Configure access and choose a model."}
					</DialogDescription>
				</DialogHeader>

				{view === "overview" && (
					<>
						{configured.length ? (
							<div className="grid gap-2">
								{configured.map((p) => (
									<button
										key={p.id}
										className="flex items-center gap-3 rounded-md border border-line p-3 text-left hover:bg-surface-muted focus-visible:outline-accent"
										onClick={() => chooseProvider(p)}
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium">{p.name}</p>
											<p className="text-xs text-muted">
												{credentialDescription(p)} · {models.filter((m) => m.provider === p.id).length} models
											</p>
										</div>
										<ChevronRight className="size-4 text-muted" />
									</button>
								))}
							</div>
						) : (
							<div className="rounded-md border border-dashed border-line p-6 text-center">
								<p className="text-sm font-medium">Connect your first provider</p>
								<p className="mt-1 text-xs text-muted">Existing Pi credentials appear here automatically.</p>
							</div>
						)}
						<Button variant="ghost" className="w-fit self-start px-0 font-semibold text-ink-soft hover:bg-transparent" onClick={() => navigate("catalog")} disabled={setupPending}>
							Add provider
						</Button>
						<Button variant="ghost" size="sm" disabled={setupPending} onClick={refresh}>
							{auth.busy ? "Checking…" : "Refresh providers"}
						</Button>
					</>
				)}

				{view === "catalog" && (
					<>
						<div className="relative">
							<Search className="absolute left-3 top-2.5 size-4 text-muted" />
							<Input
								autoFocus
								aria-label="Search providers"
								className="pl-9"
								placeholder="Search providers"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
							/>
						</div>
						<div className="max-h-72 overflow-y-auto grid gap-1">
							{providers
								.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase()))
								.map((p) => (
									<button
										key={p.id}
										className="flex items-center gap-3 rounded-md p-3 text-left hover:bg-surface-muted focus-visible:outline-accent"
										onClick={() => chooseProvider(p)}
									>
										<div className="flex-1">
											<p className="text-sm font-medium">{p.name}</p>
											<p className="text-xs text-muted">
												{p.authMethods.map((m) => m.label).join(" · ") || "External configuration"}
											</p>
										</div>
										{p.authenticated ? (
											<span className="text-xs text-accent">Configured</span>
										) : (
											<ChevronRight className="size-4 text-muted" />
										)}
									</button>
								))}
							{!providers.some((p) => `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase())) && (
								<p className="p-3 text-sm text-muted">
									No matching providers. You can add a custom endpoint below.
								</p>
							)}
						</div>
						<Button variant="secondary" onClick={() => navigate("custom")}>
							<Plus className="size-4" />
							Custom provider
						</Button>
					</>
				)}

				{view === "success" && (
					<>
						<div
							role="status"
							className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-sm text-accent"
						>
							<Check className="size-4" />
							{provider?.name ?? providerId} {checkedOnly ? "configuration checked" : "configuration saved"}
						</div>
						{modelPicker ?? (
							<div className="grid gap-2">
								<p className="text-sm text-ink-soft">
									No models are available yet. Check the provider credentials and model configuration, then
									try again.
								</p>
								<Button variant="secondary" disabled={setupPending} onClick={refresh}>
									Check again
								</Button>
								<Button variant="ghost" onClick={() => navigate("setup")}>
									Review setup
								</Button>
							</div>
						)}
						<p className="text-xs text-muted">Model access is checked when you send a message.</p>
						<Button variant="secondary" onClick={close}>
							Done
						</Button>
					</>
				)}

				{(view === "setup" || view === "custom") && (
					<>
						{view === "setup" && provider?.authenticated && (
							<div className="grid gap-3 rounded-md border border-line p-3">
								<p className="text-xs text-muted">{credentialDescription(provider)}</p>
								{modelPicker}
								<Button variant="ghost" size="sm" disabled={setupPending} onClick={refresh}>
									Refresh models
								</Button>
								{provider.canLogout && (
									<Button
										variant="destructive"
										size="sm"
										disabled={setupPending}
										onClick={() => props.onLogout(provider.id)}
									>
										Remove saved credentials
									</Button>
								)}
							</div>
						)}
						<form className="grid gap-4" onSubmit={submit}>
							{view === "custom" && (
								<>
									<div className="grid gap-1.5">
										<Label htmlFor="custom-name">Provider name</Label>
										<Input
											id="custom-name"
											required
											maxLength={60}
											value={name}
											disabled={setupPending}
											onChange={(e) => setName(e.target.value)}
											placeholder="My local server"
										/>
									</div>
									<div className="grid gap-1.5">
										<Label htmlFor="custom-url">Base URL</Label>
										<Input
											id="custom-url"
											type="url"
											required
											value={baseUrl}
											disabled={setupPending}
											onChange={(e) => setBaseUrl(e.target.value)}
											placeholder="http://localhost:11434/v1"
										/>
									</div>
									<div className="grid gap-1.5">
										<Label htmlFor="custom-api">API format</Label>
										<Select value={api} onValueChange={(v) => setApi(v as typeof api)} disabled={setupPending}>
											<SelectTrigger id="custom-api">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="openai-completions">OpenAI Chat Completions</SelectItem>
												<SelectItem value="openai-responses">OpenAI Responses</SelectItem>
												<SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
												<SelectItem value="google-generative-ai">Google Generative AI</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className="grid gap-1.5">
										<Label htmlFor="custom-models">Model IDs</Label>
										<Textarea
											id="custom-models"
											required
											value={modelIds}
											disabled={setupPending}
											onChange={(e) => setModelIds(e.target.value)}
											placeholder="One model ID per line"
										/>
										<p className="text-xs text-muted">Use the exact IDs served by your endpoint.</p>
									</div>
									<details className="rounded-md border border-line p-3">
										<summary className="cursor-pointer text-sm">Advanced model settings</summary>
										<div className="mt-3 grid gap-3">
											<p className="text-xs text-muted">
												Applies to all listed models. Leave limits blank to use Pi's defaults.
											</p>
											<div className="grid gap-1.5">
												<Label htmlFor="custom-context">Context window</Label>
												<Input
													id="custom-context"
													type="number"
													min={1}
													max={10000000}
													step={1}
													value={contextWindow}
													disabled={setupPending}
													onChange={(e) => setContextWindow(e.target.value)}
												/>
											</div>
											<div className="grid gap-1.5">
												<Label htmlFor="custom-output">Maximum output tokens</Label>
												<Input
													id="custom-output"
													type="number"
													min={1}
													max={contextWindow ? Number(contextWindow) : 10000000}
													step={1}
													value={maxTokens}
													disabled={setupPending}
													onChange={(e) => setMaxTokens(e.target.value)}
												/>
											</div>
											<label className="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={reasoning}
													disabled={setupPending}
													onChange={(e) => setReasoning(e.target.checked)}
												/>
												Supports reasoning
											</label>
											<label className="flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={images}
													disabled={setupPending}
													onChange={(e) => setImages(e.target.checked)}
												/>
												Accepts images
											</label>
										</div>
									</details>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											id="custom-no-auth"
											checked={noAuth}
											disabled={setupPending}
											onChange={(e) => {
												setNoAuth(e.target.checked);
												setApiKey("");
											}}
										/>
										This endpoint needs no authentication
									</label>
								</>
							)}
							{view === "setup" && (provider?.authMethods.length ?? 0) > 1 && (
								<div className="grid gap-1.5">
									<Label htmlFor="provider-auth-method">Sign-in method</Label>
									<Select
										value={authType}
										onValueChange={(v) => {
											setAuthType(v as typeof authType);
											setApiKey("");
										}}
										disabled={setupPending}
									>
										<SelectTrigger id="provider-auth-method">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{provider?.authMethods.map((m) => (
												<SelectItem key={m.type} value={m.type}>
													{m.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
							{((view === "custom" && !noAuth) ||
								(view === "setup" &&
									authType === "api_key" &&
									provider?.authMethods.some((m) => m.type === "api_key"))) && (
								<div className="grid gap-1.5">
									<Label htmlFor="provider-api-key">API key</Label>
									<Input
										id="provider-api-key"
										type="password"
										autoComplete="off"
										spellCheck={false}
										required={view === "custom"}
										value={apiKey}
										disabled={setupPending}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder={
											view === "custom" ? "Paste an API key" : "Paste a key, or continue for guided setup"
										}
									/>
								</div>
							)}
							{view === "setup" && !provider?.authMethods.length ? (
								<div className="grid gap-2">
									<p className="text-sm text-ink-soft">
										This provider uses external configuration. Configure its credentials in Pi or the host
										environment, then check again.
										{provider?.credentialLabel ? ` Pi reports: ${provider.credentialLabel}.` : ""}
									</p>
									<Button type="button" variant="secondary" disabled={setupPending} onClick={refresh}>
										Check again
									</Button>
								</div>
							) : (
								<>
									<p className="text-xs text-muted">
										{view === "custom" && noAuth
											? "Endpoint configuration is saved in Hopper."
											: "Credentials are saved to your shared Pi credentials."}
										{view === "custom" && !noAuth ? " Endpoint configuration is saved in Hopper." : ""}
									</p>
									<Button type="submit" variant="ghost" className="w-fit self-start px-0 font-semibold text-ink-soft hover:bg-transparent" disabled={setupPending}>
										{auth.busy && <Loader2 className="size-4 animate-spin" />}
										{view === "setup" && authType === "oauth"
											? `Sign in with ${provider?.name ?? "provider"}`
											: "Save and continue"}
									</Button>
								</>
							)}
						</form>
					</>
				)}

				{currentAuth?.notice && auth.busy && (
					<div role="status" className="grid gap-2 rounded-md bg-accent-soft p-3 text-xs text-accent">
						<p>{currentAuth.notice}</p>
						{currentAuth.url && (
							<a
								className="inline-flex items-center gap-1 underline"
								href={currentAuth.url}
								target="_blank"
								rel="noreferrer noopener"
							>
								{currentAuth.label ?? "Open sign-in"}
								<ExternalLink className="size-3" />
							</a>
						)}
					</div>
				)}
				{request?.kind === "auth" && (
					<RequestDialog
						inline
						request={request}
						respond={(value) => {
							const sent = props.onAuthResponse(request.requestId, value);
							if (sent) resolveRequest();
							return sent;
						}}
					/>
				)}
				{(error ?? currentAuth?.error) && (
					<p role="alert" className="rounded-md bg-danger-soft p-3 text-xs text-danger">
						{error ?? currentAuth?.error}
					</p>
				)}
				{setupPending && (
					<DialogFooter>
						<Button variant="secondary" onClick={props.onCancel}>
							Cancel setup
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
