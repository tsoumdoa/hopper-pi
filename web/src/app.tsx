import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  LogIn,
  Plus,
  Power,
  RefreshCw,
  Send,
  Square,
  Wrench,
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
      <p className="text-xs text-red-700">Rhino status unavailable: {error}</p>
    );
  if (!status)
    return <p className="text-xs text-stone-500">Waiting for Rhino status</p>;
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
      <dl className="grid gap-2 text-[11px]">
        {rows.map(([label, value]) => (
          <div
            className="grid grid-cols-[78px_minmax(0,1fr)] gap-2"
            key={label}
          >
            <dt className="text-stone-500">{label}</dt>
            <dd className="m-0 break-words text-stone-700">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="text-[11px]">
        <p className="font-semibold text-stone-500">Latest component errors</p>
        {errors.length ? (
          <ul className="mt-1 grid gap-1 text-red-700">
            {errors.map(([component, value]) => (
              <li key={component}>
                {titleCase(component)} · {value?.code}: {value?.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-stone-500">None</p>
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
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <span className="flex min-w-0 items-center gap-2 font-mono text-xs font-semibold text-emerald-900">
          <Wrench className="size-3.5 shrink-0" />
          {tool.name}
        </span>
        <span
          className={
            tool.status === "error"
              ? "text-xs font-semibold text-red-700"
              : tool.status === "running"
                ? "text-xs font-semibold text-orange-700"
                : "text-xs text-stone-500"
          }
        >
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto border-t border-stone-200 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-600">
          {formatValue(tool.detail)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Message({ message }: { message: ConversationMessage }) {
  const assistant = message.role === "assistant";
  return (
    <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
      <div
        className={
          assistant
            ? "grid size-8 place-items-center rounded-lg bg-emerald-950 text-[10px] font-black text-white"
            : "grid size-8 place-items-center rounded-lg bg-orange-100 text-[10px] font-black text-stone-800"
        }
      >
        {assistant ? "H" : "You"}
      </div>
      <div className="min-w-0 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-sm font-bold">
            {assistant ? "Hopper" : "You"}
          </span>
          {message.streaming && (
            <span className="text-xs text-orange-700">Working</span>
          )}
        </div>
        {message.text && (
          <div
            className={
              assistant
                ? "whitespace-pre-wrap text-[15px] leading-6"
                : "inline-block whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-stone-200 bg-white px-4 py-3 text-[15px] leading-6"
            }
          >
            {message.text}
            {message.streaming && (
              <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-orange-600 align-[-3px]" />
            )}
          </div>
        )}
        {message.thinking && (
          <Collapsible className="mt-3 text-sm text-stone-600">
            <CollapsibleTrigger className="flex items-center gap-1 font-semibold">
              <ChevronDown className="size-4" />
              Thinking
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 whitespace-pre-wrap border-l-2 border-stone-300 pl-3 text-xs leading-5">
              {message.thinking}
            </CollapsibleContent>
          </Collapsible>
        )}
        {message.tools.length > 0 && (
          <div className="mt-3 grid gap-2">
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
  const [provider, setProvider] = useState("openai");
  const [authType, setAuthType] = useState("api_key");
  const [apiKey, setApiKey] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (authType === "api_key" && !apiKey.trim()) return;
    if (
      send({
        type: "login",
        provider,
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
          Credentials use the global Pi auth store by default. Hopper keeps
          sessions and settings separate.
        </DialogDescription>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-semibold">
            Provider
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(providers.length
                  ? providers
                  : [
                      { id: "anthropic", name: "Anthropic" },
                      { id: "openai", name: "OpenAI" },
                      { id: "openai-codex", name: "OpenAI Codex" },
                      { id: "google", name: "Google" },
                    ]
                ).map((item) => (
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
                className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-800/25"
                placeholder="Paste an API key"
              />
            </label>
          )}
          <div className="mt-2 flex justify-between gap-3">
            <Button
              type="button"
              variant="destructive"
              disabled={
                !providers.find((item) => item.id === provider)?.authenticated
              }
              onClick={() => send({ type: "logout", provider })}
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
                      ? "cursor-pointer rounded-lg border border-emerald-800 bg-emerald-50 p-3"
                      : "cursor-pointer rounded-lg border border-stone-200 bg-white p-3"
                  }
                >
                  <input
                    className="sr-only"
                    type="radio"
                    value={option.value}
                    checked={value === option.value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <span className="block text-sm font-semibold">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {option.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : request.kind === "confirm" ? (
            <p className="rounded-lg bg-orange-50 p-4 text-sm text-stone-700">
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
              className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-800/25"
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
  return (
    <div className="grid min-h-dvh bg-[radial-gradient(circle_at_top_right,_rgba(23,79,59,.06),_transparent_27rem)] lg:grid-cols-[286px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-5 border-b border-stone-200 bg-[#faf8f1]/95 p-4 lg:min-h-dvh lg:border-b-0 lg:border-r lg:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-emerald-950 font-black text-white shadow-lg shadow-emerald-950/15">
              H
            </div>
            <div>
              <p className="text-sm font-extrabold tracking-tight">Hopper</p>
              <p className="text-xs text-stone-500">Rhino local agent</p>
            </div>
          </div>
          <Badge className={isMockMode ? "bg-orange-100 text-orange-800" : ""}>
            {isMockMode
              ? "Mock mode"
              : state.connection.status === "connected"
                ? "Connected"
                : titleCase(state.connection.status)}
          </Badge>
        </div>
        <Button onClick={() => send({ type: "new_session" })}>
          <Plus className="size-4" />
          New session
        </Button>
        <div className="grid gap-3 border-t border-stone-200 pt-5">
          <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-stone-500">
            Agent
          </p>
          <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
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
          <label className="grid gap-1.5 text-xs font-semibold text-stone-600">
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
        <div className="grid gap-3 border-t border-stone-200 pt-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-stone-500">
              Provider
            </p>
            <span className="text-xs text-emerald-800">
              {state.providers.some((provider) => provider.authenticated)
                ? "Connected"
                : "Not configured"}
            </span>
          </div>
          <p className="text-xs leading-5 text-stone-500">
            Connect a model provider using Hopper's private settings.
          </p>
          <Button variant="secondary" onClick={() => setProviderOpen(true)}>
            Manage provider
          </Button>
        </div>
        <div className="mt-auto grid gap-3 border-t border-stone-200 pt-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-[.1em] text-stone-500">
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
          <div className="rounded-lg border border-stone-200 bg-[#fffdf8] p-3">
            <div className="flex items-start gap-2">
              <span
                className={
                  state.connection.status === "connected"
                    ? "mt-1.5 size-2 rounded-full bg-emerald-600"
                    : "mt-1.5 size-2 rounded-full bg-orange-500"
                }
              />
              <div>
                <p className="text-xs font-bold">
                  {titleCase(state.connection.status)}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-stone-500">
                  {state.connection.detail}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-stone-500">
                  {state.backendDetail}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex items-center justify-between border-b border-stone-200 bg-[#f4f1e8]/85 px-5 py-4 backdrop-blur lg:px-10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.1em] text-orange-700">
              Active conversation
            </p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight">
              {state.session.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {state.session.isStreaming && (
              <Badge className="bg-orange-100 text-orange-800">Working</Badge>
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
            className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-8 lg:px-10"
            ref={conversation}
          >
            {state.session.messages.length === 0 ? (
              <section className="mx-auto mt-[max(4vh,1rem)] max-w-2xl rounded-3xl border border-stone-200 bg-[#fffdf8]/90 p-8 shadow-xl shadow-stone-950/5 lg:p-11">
                <p className="text-xs font-bold uppercase tracking-[.12em] text-orange-700">
                  Ready when Rhino is
                </p>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight lg:text-4xl">
                  Build in Grasshopper by describing what you need.
                </h2>
                <p className="mt-4 max-w-xl text-stone-600">
                  Hopper can inspect the active canvas, add and wire components,
                  run Rhino scripts, and explain each tool call as it works.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
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
        <footer className="bg-gradient-to-t from-canvas via-canvas to-transparent px-5 pb-4 pt-8 lg:px-10">
          <form
            className="mx-auto w-full max-w-3xl rounded-2xl border border-stone-300 bg-white p-3 shadow-xl shadow-stone-950/10 focus-within:ring-2 focus-within:ring-emerald-900/15"
            onSubmit={submit}
          >
            <Textarea
              rows={2}
              className="min-h-16 resize-none border-0 shadow-none focus:ring-0"
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
            <div className="flex items-center gap-2 border-t border-stone-100 pt-2">
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as typeof mode)}
              >
                <SelectTrigger className="h-8 w-40 border-0 bg-stone-50 text-xs">
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
              <span className="hidden flex-1 text-xs text-stone-500 sm:block">
                Enter to send, Shift+Enter for a new line
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
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-stone-500">
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
                ? "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg"
                : notice.level === "warning"
                  ? "rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 shadow-lg"
                  : "rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-700 shadow-lg"
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
                className="text-stone-500"
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
