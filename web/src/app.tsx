import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  LogIn,
  Power,
  RefreshCw,
  Send,
  Square,
  X,
} from "lucide-react";
import { useHopperConnection } from "./hooks/use-hopper-connection";
import { useRuntimeStatus } from "./hooks/use-runtime-status";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog";
import { ScrollArea } from "./components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { formatValue, titleCase } from "./lib/utils";
import type { ConversationMessage, UiRequest } from "./state/hopper-types";

function RuntimeStatus({
  status,
  error,
}: {
  status: Record<string, unknown> | null;
  error: string | null;
}) {
  if (error)
    return (
      <p className="font-mono text-[11px] text-red-600">Rhino status unavailable: {error}</p>
    );
  if (!status)
    return <p className="font-mono text-[11px] text-zinc-500">Waiting for Rhino status</p>;
  const lifecycle = status.lifecycle as Record<string, unknown> | undefined;
  const transport = status.transport as Record<string, unknown> | undefined;
  const host = status.host as Record<string, unknown> | undefined;
  const rhino = status.rhino as Record<string, unknown> | undefined;
  const grasshopper = status.grasshopper as Record<string, unknown> | undefined;
  const dispatcher = status.dispatcher as Record<string, unknown> | undefined;
  const rows = [
    ["Lifecycle", titleCase(String(lifecycle?.state ?? "unknown"))],
    ["Transport", transport?.ready ? "Ready" : "Not ready"],
    [
      "Host",
      `${titleCase(String(host?.state ?? "unknown"))}${host?.processId ? ` · PID ${host.processId}` : ""} · ${host?.healthFailureCount ?? 0} health failures`,
    ],
    [
      "Rhino",
      rhino?.activeDocument
        ? String(rhino.documentName ?? "Active, untitled")
        : "No active document",
    ],
    ["Grasshopper", titleCase(String(grasshopper?.state ?? "unknown"))],
    [
      "GH document",
      grasshopper?.activeDocument
        ? String(grasshopper.documentName ?? "Active, untitled")
        : "No active document",
    ],
    [
      "Dispatcher",
      `${dispatcher?.depth ?? "?"}/${dispatcher?.capacity ?? "?"} queued`,
    ],
  ];
  const errors = Object.entries(
    (status.errors ?? {}) as Record<
      string,
      { code?: string; message?: string } | null
    >,
  ).filter(([, value]) => value);
  return (
    <div className="grid gap-3">
      <dl className="grid gap-px border border-zinc-200 bg-zinc-200 font-mono text-[11px]">
        {rows.map(([label, value]) => (
          <div
            className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 bg-white px-2 py-1"
            key={label}
          >
            <dt className="text-zinc-500">{label}</dt>
            <dd className="m-0 break-words text-zinc-700">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="font-mono text-[11px]">
        <p className="font-medium uppercase tracking-[.08em] text-zinc-500">Component errors</p>
        {errors.length ? (
          <ul className="mt-1 grid gap-1 text-red-600">
            {errors.map(([component, value]) => (
              <li key={component}>
                {titleCase(component)} · {value?.code}: {value?.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-zinc-500">None</p>
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: ConversationMessage["tools"][number] }) {
  const [open, setOpen] = useState(tool.status === "error");
  const label =
    tool.status === "running"
      ? "Running"
      : tool.status === "error"
        ? "Failed"
        : "Complete";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden border border-zinc-200 bg-white hover:border-zinc-300"
    >
      <CollapsibleTrigger className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 text-left before:content-['+'] data-[state=open]:before:content-['−']">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-black">
          {tool.name}
        </span>
        <span
          className={
            tool.status === "error"
              ? "font-mono text-[11px] font-medium uppercase tracking-[.08em] text-red-600"
              : tool.status === "running"
                ? "animate-pulse font-mono text-[11px] font-medium uppercase tracking-[.08em] text-black"
                : "font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500"
          }
        >
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto border-t border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-600">
          {formatValue(tool.detail)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Message({ message }: { message: ConversationMessage }) {
  const assistant = message.role === "assistant";
  return (
    <article className="mb-8">
      <div className="min-w-0">
        <div className="mb-2 flex items-baseline gap-2.5 font-mono text-[11px]">
          <span className={assistant ? "font-medium uppercase tracking-[.08em] text-zinc-500" : "font-medium uppercase tracking-[.08em] text-black"}>
            {assistant ? "Hopper" : "You"}
          </span>
          {message.streaming && (
            <span className="text-zinc-500 before:mr-2.5 before:content-['·']">Working</span>
          )}
        </div>
        {message.text && (
          <div
            className={
              assistant
                ? "whitespace-pre-wrap text-[15px] leading-6"
                : "inline-block whitespace-pre-wrap border border-black px-3.5 py-3 text-[15px] leading-6"
            }
          >
            {message.text}
            {message.streaming && (
              <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-black align-[-3px]" />
            )}
          </div>
        )}
        {message.thinking && (
          <Collapsible className="my-3 text-[13px] text-zinc-500">
            <CollapsibleTrigger className="flex items-center gap-1 font-mono text-[11px] before:inline-block before:w-3 before:content-['+'] data-[state=open]:before:content-['−']">
              Thinking
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 whitespace-pre-wrap border-l border-zinc-300 pl-3 text-[13px] leading-5">
              {message.thinking}
            </CollapsibleContent>
          </Collapsible>
        )}
        {message.tools.length > 0 && (
          <div className="mt-3 grid gap-1.5">
            {message.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ProviderDialog({
  open,
  onOpenChange,
  send,
  providers,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  send(message: Record<string, unknown>): boolean;
  providers: Array<{ id: string; name: string; authenticated: boolean }>;
}) {
  const [provider, setProvider] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [apiKey, setApiKey] = useState("");
  const providerOptions = providers.length
    ? providers
    : [
        { id: "anthropic", name: "Anthropic", authenticated: false },
        { id: "openai", name: "OpenAI", authenticated: false },
        { id: "openai-codex", name: "OpenAI Codex", authenticated: false },
        { id: "google", name: "Google", authenticated: false },
      ];
  const selectedProvider =
    provider ||
    providerOptions.find((item) => item.authenticated)?.id ||
    providerOptions[0]?.id ||
    "";
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProvider || (authType === "api_key" && !apiKey.trim())) return;
    if (
      send({
        type: "login",
        provider: selectedProvider,
        authType,
        ...(authType === "api_key" ? { apiKey: apiKey.trim() } : {}),
      })
    )
      setApiKey("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Model provider</DialogTitle>
        <DialogDescription>
          Hopper reads Pi's global auth file by default. Sessions and model
          settings stay separate.
        </DialogDescription>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-semibold">
            Provider
            <Select value={selectedProvider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Sign-in method
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api_key">API key</SelectItem>
                <SelectItem value="oauth">Browser sign-in</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {authType === "api_key" && (
            <label className="grid gap-1.5 text-sm font-semibold">
              API key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className="h-8 rounded-[3px] border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:ring-1 focus:ring-black"
                placeholder="Paste an API key"
              />
            </label>
          )}
          <div className="mt-2 flex justify-between gap-3">
            <Button
              type="button"
              variant="destructive"
              disabled={
                !providerOptions.find((item) => item.id === selectedProvider)
                  ?.authenticated
              }
              onClick={() => send({ type: "logout", provider: selectedProvider })}
            >
              Log out
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button type="submit">
                <LogIn className="size-4" />
                Connect
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UiRequestDialog({
  request,
  send,
  onResolved,
}: {
  request: UiRequest | null;
  send(message: Record<string, unknown>): boolean;
  onResolved(): void;
}) {
  const [value, setValue] = useState("");
  useEffect(
    () => setValue(request?.prefill ?? request?.options?.[0]?.value ?? ""),
    [request],
  );
  if (!request) return null;
  const finish = (cancelled = false) => {
    if (
      send({
        type: "ui_response",
        requestId: request.requestId,
        value: cancelled ? null : request.kind === "confirm" ? true : value,
      })
    )
      onResolved();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(true);
      }}
    >
      <DialogContent>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description && (
          <DialogDescription>{request.description}</DialogDescription>
        )}
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            finish();
          }}
        >
          {request.kind === "select" ||
          (request.kind === "auth" && request.options?.length) ? (
            <div className="grid gap-2">
              {request.options?.map((option) => (
                <label
                  key={option.id}
                  className={
                    value === option.value
                      ? "cursor-pointer bg-black p-3 text-white"
                      : "cursor-pointer border border-zinc-200 bg-white p-3 hover:bg-zinc-50"
                  }
                >
                  <input
                    className="sr-only"
                    type="radio"
                    value={option.value}
                    checked={value === option.value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                    <span className="block text-[13px] font-medium">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className={value === option.value ? "mt-0.5 block text-xs text-zinc-300" : "mt-0.5 block text-xs text-zinc-500"}>
                      {option.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : request.kind === "confirm" ? (
            <p className="border border-zinc-200 p-3 text-sm text-zinc-600">
              {request.description}
            </p>
          ) : request.kind === "editor" ? (
            <Textarea
              className="min-h-56 font-mono text-xs"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={request.placeholder}
            />
          ) : (
            <input
              autoFocus
              type={request.secret ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={request.placeholder}
              className="h-8 rounded-[3px] border border-zinc-300 px-2.5 text-sm outline-none focus:ring-1 focus:ring-black"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => finish(true)}
            >
              Cancel
            </Button>
            <Button type="submit">
              {request.kind === "confirm" ? "Confirm" : "Continue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function App() {
  const { state, dispatch, token, send, prompt, reconnect, isMockMode } =
    useHopperConnection();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [providerOpen, setProviderOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  useRuntimeStatus(
    token,
    state.connection.status === "connected",
    dispatch,
    isMockMode,
  );
  useEffect(() => {
    conversation.current?.scrollTo({
      top: conversation.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.session.messages]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && prompt(text, mode)) setDraft("");
  };
  const selectModel = (value: string) => {
    const [provider, id] = value.split("/");
    send({ type: "set_model", provider, id });
  };
  const authenticatedProviders = state.providers.filter(
    (provider) => provider.authenticated,
  );
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-200 bg-white p-3.5 lg:flex lg:min-h-dvh lg:flex-col lg:items-stretch lg:gap-5 lg:border-b-0 lg:border-r lg:p-4">
        <div className="flex items-baseline justify-between gap-2 lg:border-b lg:border-black lg:pb-5">
          <p className="text-[15px] font-semibold tracking-tight">Hopper</p>
          <p className="hidden font-mono text-[11px] tracking-[.02em] text-zinc-500 lg:block">Rhino local agent</p>
        </div>
        <div className="flex gap-2 lg:grid">
          <Button className="max-lg:px-2.5" onClick={() => send({ type: "new_session" })}>New session</Button>
          <Button className="lg:hidden" variant={mobileSettingsOpen ? "default" : "secondary"} onClick={() => setMobileSettingsOpen((open) => !open)}>Settings</Button>
        </div>
        <div className={`col-span-2 grid gap-2 ${mobileSettingsOpen ? "" : "max-lg:hidden"}`}>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
            Agent
          </p>
          <label className="mt-1 grid gap-2 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
            Model
            <Select
              disabled={
                state.connection.status !== "connected" || !state.models.length
              }
              value={
                state.selectedModel
                  ? `${state.selectedModel.provider}/${state.selectedModel.id}`
                  : ""
              }
              onValueChange={selectModel}
            >
              <SelectTrigger>
                <SelectValue placeholder="Waiting for models" />
              </SelectTrigger>
              <SelectContent>
                {state.models.map((model) => (
                  <SelectItem
                    key={`${model.provider}/${model.id}`}
                    value={`${model.provider}/${model.id}`}
                  >
                    {model.name ?? model.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="mt-1 grid gap-2 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
            Thinking
            <Select
              disabled={state.connection.status !== "connected"}
              value={state.thinkingLevel}
              onValueChange={(level) => send({ type: "set_thinking", level })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(state.availableThinkingLevels.length
                  ? state.availableThinkingLevels
                  : ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
                ).map((level) => (
                  <SelectItem key={level} value={level}>
                    {level === "xhigh" ? "Extra high" : titleCase(level)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className={`col-span-2 grid gap-3 border-t border-zinc-200 pt-5 ${mobileSettingsOpen ? "" : "max-lg:hidden"}`}>
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
              Provider
            </p>
            <span className="font-mono text-[11px] text-zinc-500">
              {authenticatedProviders.length
                ? `${authenticatedProviders[0]?.name}${authenticatedProviders.length > 1 ? ` +${authenticatedProviders.length - 1}` : ""}`
                : "Not configured"}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Connect a model provider using Hopper's private settings.
          </p>
          <Button variant="secondary" onClick={() => setProviderOpen(true)}>
            Manage provider
          </Button>
        </div>
        <div className="col-span-2 mt-auto hidden gap-3 border-t border-zinc-200 pt-5 lg:grid">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
              Rhino runtime
            </p>
            <Button size="sm" variant="ghost" onClick={reconnect}>
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
          <RuntimeStatus
            status={state.runtimeStatus}
            error={state.runtimeStatusError}
          />
        </div>
        <div className="col-span-2 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t border-black pt-3 lg:pt-4">
          <span
            className={
              state.connection.status === "connected"
                ? "mt-1.5 size-2 border border-black bg-black"
                : "mt-1.5 size-2 animate-pulse border border-black bg-white"
            }
          />
          <div>
            <p className="text-[13px] font-medium">{titleCase(state.connection.status)}</p>
            <p className="mt-0.5 font-mono text-[11px] leading-4 text-zinc-500 max-lg:hidden">{state.connection.detail}</p>
            <p className="mt-1 font-mono text-[11px] leading-4 text-zinc-500 max-lg:hidden">{state.backendDetail}</p>
          </div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex min-h-[52px] items-center justify-between gap-4 border-b border-zinc-200 px-4 lg:px-8">
          <h1 className="min-w-0 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap">{state.session.name}</h1>
          <div className="flex items-center gap-2">
            {state.session.isStreaming && (
              <Badge>Working</Badge>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => send({ type: "shutdown" })}
            >
              <Power className="size-3.5" />
              Shut down
            </Button>
          </div>
        </header>
        <ScrollArea className="min-h-0">
          <div
            className="mx-auto flex w-full max-w-[760px] flex-col px-4 py-10 lg:px-8"
            ref={conversation}
          >
            {state.session.messages.length === 0 ? (
              <section className="mt-[max(8vh,1.5rem)] grid max-w-[600px] gap-4">
                <p className="border-b border-black pb-3 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-zinc-500">
                  Ready when Rhino is
                </p>
                <h2 className="text-[clamp(28px,4vw,40px)] font-medium tracking-[-.03em] leading-[1.1]">
                  Build in Grasshopper by describing what you need.
                </h2>
                <p className="max-w-[520px] text-sm text-zinc-600">
                  Hopper inspects the active canvas, adds and wires components, runs Rhino scripts, and shows each tool call as it works.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "Inspect the active Grasshopper canvas and summarize its structure and any errors.",
                    "Create a simple parametric pavilion on the active Grasshopper canvas.",
                    "Check the active Rhino document and tell me what geometry is present.",
                  ].map((suggestion) => (
                    <Button
                      key={suggestion}
                      size="sm"
                      variant="secondary"
                      onClick={() => setDraft(suggestion)}
                    >
                      {suggestion.replace(/\.$/, "")}
                    </Button>
                  ))}
                </div>
              </section>
            ) : (
              state.session.messages.map((message) => (
                <Message key={message.id} message={message} />
              ))
            )}
          </div>
        </ScrollArea>
        <footer className="px-4 pb-4 lg:px-8">
          <form
            className="mx-auto w-full max-w-[760px] rounded-[3px] border border-black bg-white focus-within:ring-1 focus-within:ring-black"
            onSubmit={submit}
          >
            <Textarea
              rows={1}
              className="min-h-12 resize-none border-0 px-3.5 pt-3.5 pb-1.5 shadow-none focus:ring-0"
              disabled={state.connection.status !== "connected"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  (
                    event.currentTarget.form as HTMLFormElement
                  )?.requestSubmit();
                }
              }}
              placeholder="Ask Hopper to work in Rhino or Grasshopper"
            />
            <div className="flex items-center gap-2 px-2 pb-2">
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as typeof mode)}
              >
                <SelectTrigger className="h-7 w-40 border-0 bg-white px-1 font-mono text-[11px] text-zinc-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prompt">New turn</SelectItem>
                  <SelectItem value="steer">Steer current turn</SelectItem>
                  <SelectItem value="follow_up">
                    Follow up after turn
                  </SelectItem>
                </SelectContent>
              </Select>
              <span className="hidden flex-1 text-right font-mono text-[11px] text-zinc-400 sm:block">
                Enter to send · Shift+Enter for a new line
              </span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!state.session.isStreaming}
                onClick={() => send({ type: "abort" })}
              >
                <Square className="size-3" />
                Stop
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  !draft.trim() || state.connection.status !== "connected"
                }
              >
                <Send className="size-3.5" />
                Send
              </Button>
            </div>
          </form>
          <p className="mx-auto mt-2 max-w-[760px] font-mono text-[11px] text-zinc-400">
            Hopper can change the active Rhino document and Grasshopper canvas.
            Review important edits.
          </p>
        </footer>
      </main>
      <ProviderDialog
        open={providerOpen}
        onOpenChange={setProviderOpen}
        send={send}
        providers={state.providers}
      />
      <UiRequestDialog
        request={state.activeUiRequest}
        send={send}
        onResolved={() => dispatch({ type: "ui-request-resolved" })}
      />
      <div className="fixed bottom-4 right-4 z-50 grid w-[min(380px,calc(100%-2rem))] gap-2">
        {state.notifications.map((notice) => (
          <div
            key={notice.id}
            className={
              notice.level === "error"
                ? "border border-red-600 bg-red-600 p-3 text-xs text-white"
                : notice.level === "warning"
                  ? "border border-amber-600 bg-white p-3 text-xs text-black"
                  : "border border-black bg-white p-3 text-xs text-black"
            }
          >
            <div className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{notice.message}</p>
                {notice.url && (
                  <a
                    className="mt-1 block text-xs font-bold underline"
                    href={notice.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {notice.label ?? "Open link"}
                  </a>
                )}
              </div>
              <button
                className="text-zinc-500"
                onClick={() =>
                  dispatch({ type: "dismiss-toast", id: notice.id })
                }
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
