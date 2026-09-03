const elements = {
  shell: document.querySelector("#app-shell"),
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcome-card"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  sendButton: document.querySelector("#send-button"),
  sendMode: document.querySelector("#send-mode"),
  stopButton: document.querySelector("#stop-button"),
  newSessionButton: document.querySelector("#new-session-button"),
  mobileSettingsButton: document.querySelector("#mobile-settings-button"),
  reconnectButton: document.querySelector("#reconnect-button"),
  bannerReconnectButton: document.querySelector("#banner-reconnect-button"),
  shutdownButton: document.querySelector("#shutdown-button"),
  connectionLabel: document.querySelector("#connection-label"),
  connectionDetail: document.querySelector("#connection-detail"),
  backendDetail: document.querySelector("#backend-detail"),
  connectionBanner: document.querySelector("#connection-banner"),
  connectionBannerText: document.querySelector("#connection-banner-text"),
  runtimePill: document.querySelector("#runtime-pill"),
  runtimeStatusRefresh: document.querySelector("#runtime-status-refresh"),
  runtimeStatusSummary: document.querySelector("#runtime-status-summary"),
  runtimeLifecycle: document.querySelector("#runtime-lifecycle"),
  runtimeTransport: document.querySelector("#runtime-transport"),
  runtimeInstance: document.querySelector("#runtime-instance"),
  runtimeHost: document.querySelector("#runtime-host"),
  runtimeRhinoDocument: document.querySelector("#runtime-rhino-document"),
  runtimeGrasshopper: document.querySelector("#runtime-grasshopper"),
  runtimeGrasshopperDocument: document.querySelector("#runtime-grasshopper-document"),
  runtimeDispatcher: document.querySelector("#runtime-dispatcher"),
  runtimeErrorList: document.querySelector("#runtime-error-list"),
  sessionTitle: document.querySelector("#session-title"),
  modelSelect: document.querySelector("#model-select"),
  thinkingSelect: document.querySelector("#thinking-select"),
  providerState: document.querySelector("#provider-state"),
  providerSummary: document.querySelector("#provider-summary"),
  openAccountButton: document.querySelector("#open-account-button"),
  accountDialog: document.querySelector("#account-dialog"),
  accountForm: document.querySelector("#account-form"),
  accountCancelButton: document.querySelector("#account-cancel-button"),
  accountNotice: document.querySelector("#account-notice"),
  accountError: document.querySelector("#account-error"),
  providerSelect: document.querySelector("#provider-select"),
  authTypeSelect: document.querySelector("#auth-type-select"),
  apiKeyField: document.querySelector("#api-key-field"),
  apiKeyInput: document.querySelector("#api-key-input"),
  loginButton: document.querySelector("#login-button"),
  logoutButton: document.querySelector("#logout-button"),
  uiDialog: document.querySelector("#ui-request-dialog"),
  uiForm: document.querySelector("#ui-request-form"),
  uiTitle: document.querySelector("#ui-request-title"),
  uiDescription: document.querySelector("#ui-request-description"),
  uiControl: document.querySelector("#ui-request-control"),
  uiCancel: document.querySelector("#ui-request-cancel"),
  uiSubmit: document.querySelector("#ui-request-submit"),
  toastRegion: document.querySelector("#toast-region"),
};

function setMobileSettings(open) {
  const sidebar = elements.mobileSettingsButton.closest(".sidebar");
  sidebar.dataset.settingsOpen = String(open);
  elements.mobileSettingsButton.setAttribute("aria-expanded", String(open));
}

const state = {
  socket: null,
  token: readToken(),
  authenticated: false,
  intentionalClose: false,
  reconnectAttempt: 0,
  reconnectTimer: null,
  runtimeStatusTimer: null,
  runtimeStatusInFlight: false,
  streaming: false,
  activeAssistant: null,
  tools: new Map(),
  models: [],
  providers: [],
  currentProvider: "",
  pendingUiRequest: null,
  uiQueue: [],
};

function readToken() {
  const raw = window.location.hash.slice(1);
  let token = "";
  if (raw) {
    const params = new URLSearchParams(raw);
    try {
      token = params.get("token") || (raw.includes("=") ? "" : decodeURIComponent(raw));
    } catch {
      token = "";
    }
    if (token) {
      sessionStorage.setItem("hopper.sessionToken", token);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }
  return token || sessionStorage.getItem("hopper.sessionToken") || "";
}

function socketUrl() {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function connect() {
  clearTimeout(state.reconnectTimer);
  if (!state.token) {
    setConnection("error", "Session token missing", "Run _HopperCode in Rhino to open a fresh link.");
    showBanner("This page has no Hopper session token. Reopen it from Rhino.");
    return;
  }

  if (state.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)) {
    return;
  }

  state.intentionalClose = false;
  state.authenticated = false;
  setConnection("connecting", "Connecting", "Opening the local Hopper host");
  elements.reconnectButton.hidden = true;

  const socket = new WebSocket(socketUrl());
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.reconnectAttempt = 0;
    setConnection("connecting", "Authenticating", "Confirming the Rhino session");
    send({ type: "authenticate", token: state.token }, { requireAuth: false });
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showToast("Hopper sent an unreadable message.", "error");
      return;
    }
    handleServerMessage(message);
  });

  socket.addEventListener("close", (event) => {
    if (state.socket !== socket) return;
    state.socket = null;
    state.authenticated = false;
    stopRuntimeStatusPolling();
    setStreaming(false);
    setConnection("disconnected", "Disconnected", event.reason || "The local host closed the connection");
    showBanner("Connection to the local Hopper host was lost.");
    elements.reconnectButton.hidden = false;
    if (!state.intentionalClose) scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    if (state.socket === socket) {
      setConnection("error", "Connection failed", "The local Hopper host did not respond");
    }
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  const delay = Math.min(1000 * 2 ** state.reconnectAttempt, 10000);
  state.reconnectAttempt += 1;
  state.reconnectTimer = setTimeout(connect, delay);
  elements.connectionDetail.textContent = `Retrying in ${Math.ceil(delay / 1000)} seconds`;
}

function reconnectNow() {
  state.intentionalClose = true;
  state.socket?.close(1000, "Reconnect requested");
  state.socket = null;
  state.reconnectAttempt = 0;
  clearTimeout(state.reconnectTimer);
  connect();
}

function send(message, options = {}) {
  const requireAuth = options.requireAuth !== false;
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    showToast("Hopper is not connected.", "error");
    return false;
  }
  if (requireAuth && !state.authenticated) {
    showToast("Hopper is still authenticating.", "warning");
    return false;
  }
  state.socket.send(JSON.stringify(message));
  return true;
}

function handleServerMessage(message) {
  switch (message.type) {
    case "snapshot":
      markAuthenticated();
      applySnapshot(message.snapshot || message.data || message);
      break;
    case "agent_event":
      markAuthenticated();
      handleAgentEvent(message.event || message.data || message);
      break;
    case "ui_request":
      markAuthenticated();
      enqueueUiRequest(message.request || message);
      break;
    case "ui_notification":
      showToast(message.message || message.text || "Hopper notification", message.level || message.notificationType || "info");
      break;
    case "ui_status":
      handleUiStatus(message);
      break;
    case "ui_widget":
      handleUiWidget(message);
      break;
    case "auth_event":
      handleAuthEvent(message.event || message.data || message);
      break;
    case "status":
      handleStatus(message);
      break;
    case "session_replaced":
      markAuthenticated();
      resetConversation(message.session || message);
      break;
    case "models":
      markAuthenticated();
      applyModels(message);
      break;
    case "error":
      handleError(message);
      break;
    default:
      console.debug("Unknown Hopper message", message);
  }
}

function markAuthenticated() {
  state.authenticated = true;
  setConnection("connected", "Connected", "Private Hopper host on this computer");
  hideBanner();
  startRuntimeStatusPolling();
}

function startRuntimeStatusPolling() {
  if (state.runtimeStatusTimer) return;
  void refreshRuntimeStatus();
  state.runtimeStatusTimer = setInterval(() => void refreshRuntimeStatus(), 3000);
}

function stopRuntimeStatusPolling() {
  clearInterval(state.runtimeStatusTimer);
  state.runtimeStatusTimer = null;
}

async function refreshRuntimeStatus() {
  if (!state.authenticated || !state.token || state.runtimeStatusInFlight) return;
  state.runtimeStatusInFlight = true;
  elements.runtimeStatusRefresh.disabled = true;
  try {
    const response = await fetch("/api/runtime-status", {
      headers: { Authorization: `Bearer ${state.token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status request returned HTTP ${response.status}`);
    renderRuntimeStatus(await response.json());
  } catch (error) {
    elements.runtimeStatusSummary.textContent = `Rhino status unavailable: ${error instanceof Error ? error.message : String(error)}`;
    elements.runtimeStatusSummary.dataset.state = "failed";
  } finally {
    state.runtimeStatusInFlight = false;
    elements.runtimeStatusRefresh.disabled = false;
  }
}

function renderRuntimeStatus(status) {
  const lifecycleReason = status.lifecycle.reason
    ? ` (${status.lifecycle.reason.code}: ${status.lifecycle.reason.message})`
    : "";
  elements.runtimeLifecycle.textContent = `${titleCase(status.lifecycle.state)}${lifecycleReason}`;
  elements.runtimeTransport.textContent = status.transport.ready ? "Ready" : "Not ready";
  elements.runtimeInstance.textContent = status.transport.lifecycleInstanceId || "Not assigned";
  const hostDetails = [
    titleCase(status.host.state),
    status.host.processId === null ? "PID unavailable" : `PID ${status.host.processId}`,
    status.host.nodeVersion || "Node version unavailable",
    `${titleCase(status.host.handshake)} handshake`,
    `${status.host.healthFailureCount} health failure${status.host.healthFailureCount === 1 ? "" : "s"}`,
  ];
  elements.runtimeHost.textContent = hostDetails.join(" · ");
  elements.runtimeRhinoDocument.textContent = status.rhino.activeDocument
    ? status.rhino.documentName || "Active, untitled"
    : "No active document";
  elements.runtimeGrasshopper.textContent = titleCase(status.grasshopper.state);
  elements.runtimeGrasshopper.dataset.state = status.grasshopper.state;
  elements.runtimeGrasshopperDocument.textContent = status.grasshopper.activeDocument
    ? status.grasshopper.documentName || "Active, untitled"
    : "No active document";
  elements.runtimeDispatcher.textContent = `${status.dispatcher.depth}/${status.dispatcher.capacity} queued · ${status.dispatcher.acceptingExternalWork ? "accepting work" : "not accepting work"}`;
  elements.runtimeStatusSummary.textContent = `Rhino snapshot revision ${status.revision}`;
  elements.runtimeStatusSummary.dataset.state = status.lifecycle.state === "faulted" ? "failed" : "live";

  elements.runtimeErrorList.replaceChildren();
  const errors = Object.entries(status.errors).filter(([, error]) => error);
  if (errors.length === 0) {
    const item = document.createElement("li");
    item.textContent = "None";
    elements.runtimeErrorList.append(item);
  } else {
    for (const [component, error] of errors) {
      const item = document.createElement("li");
      item.textContent = `${titleCase(component)} · ${error.code}: ${error.message}`;
      elements.runtimeErrorList.append(item);
    }
  }
}

function handleStatus(message) {
  const value = message.status || message.state || "connected";
  const detail = message.message || message.detail || "Private Hopper host on this computer";
  if (["authenticated", "ready", "connected", "idle", "streaming"].includes(value)) {
    markAuthenticated();
  }
  if (value === "streaming" || typeof message.streaming === "boolean") {
    setStreaming(value === "streaming" || message.streaming === true);
  }
  if (["error", "failed"].includes(value)) {
    setConnection("error", "Host error", detail);
    showBanner(detail);
  }
  if (message.scope === "auth" || message.provider) {
    updateProviderStatus(message);
  }
  if (detail && !["connected", "ready", "authenticated"].includes(detail.toLowerCase())) {
    elements.runtimePill.textContent = value === "streaming" ? "Working" : titleCase(value);
  }
}

function applySnapshot(snapshot) {
  if (snapshot.models || snapshot.providers) applyModels(snapshot);
  if (snapshot.model) selectCurrentModel(snapshot.model);
  if (snapshot.thinkingLevel || snapshot.thinking) {
    elements.thinkingSelect.value = snapshot.thinkingLevel || snapshot.thinking;
  }
  if (Array.isArray(snapshot.availableThinkingLevels)) {
    const current = snapshot.thinkingLevel || snapshot.thinking;
    elements.thinkingSelect.replaceChildren();
    for (const level of snapshot.availableThinkingLevels) {
      elements.thinkingSelect.append(new Option(titleCase(level === "xhigh" ? "extra high" : level), level));
    }
    if (current) elements.thinkingSelect.value = current;
  }
  if (snapshot.sessionName || snapshot.session?.name) {
    elements.sessionTitle.textContent = snapshot.sessionName || snapshot.session.name;
  }
  if (Array.isArray(snapshot.messages)) {
    clearMessages();
    for (const message of snapshot.messages) renderStoredMessage(message);
  }
  setStreaming(Boolean(snapshot.streaming || snapshot.isStreaming));
  elements.loginButton.disabled = false;
  const loginProvider = elements.providerSelect.value;
  if (
    elements.accountDialog.open &&
    loginProvider &&
    state.models.some((model) => (model.provider || model.providerId) === loginProvider)
  ) {
    elements.accountDialog.close();
    showToast(`${providerLabel(loginProvider)} connected.`, "info");
  }
}

function resetConversation(session = {}) {
  clearMessages();
  state.activeAssistant = null;
  state.tools.clear();
  elements.sessionTitle.textContent = session.name || session.sessionName || "New Rhino session";
  setStreaming(false);
  if (Array.isArray(session.messages)) {
    for (const message of session.messages) renderStoredMessage(message);
  }
  elements.composerInput.focus();
}

function clearMessages() {
  for (const child of [...elements.conversation.children]) {
    if (child !== elements.welcome) child.remove();
  }
  elements.welcome.hidden = false;
}

function renderStoredMessage(message) {
  if (!message || !["user", "assistant", "toolResult", "tool_result"].includes(message.role)) return;
  if (message.role === "toolResult" || message.role === "tool_result") {
    finishTool(message.toolCallId || message.id, message.content, Boolean(message.isError));
    return;
  }

  const content = message.content;
  if (typeof content === "string") {
    appendMessage(message.role, content, { id: message.id });
    return;
  }

  const textParts = [];
  const thinkingParts = [];
  const toolParts = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part.type === "text") textParts.push(part.text || "");
    if (part.type === "thinking") thinkingParts.push(part.thinking || part.text || "");
    if (["toolCall", "tool_call", "tool_use"].includes(part.type)) toolParts.push(part);
  }
  const rendered = appendMessage(message.role, textParts.join(""), { id: message.id, thinking: thinkingParts.join("\n") });
  for (const tool of toolParts) {
    addTool(rendered, tool.id || tool.toolCallId, tool.name || tool.toolName, tool.arguments || tool.input);
  }
}

function handleAgentEvent(event) {
  const eventType = event.type;
  if (["agent_start", "turn_start"].includes(eventType)) {
    setStreaming(true);
    return;
  }
  if (["agent_end", "agent_settled"].includes(eventType)) {
    setStreaming(false);
    finishActiveAssistant();
    return;
  }
  if (eventType === "message_start") {
    const message = event.message || event;
    if (message.role === "assistant") {
      state.activeAssistant = appendMessage("assistant", "", { id: message.id, streaming: true });
    }
    return;
  }
  if (eventType === "message_update") {
    handleMessageUpdate(event);
    return;
  }
  if (eventType === "message_end") {
    const message = event.message;
    if (message?.role === "assistant" && !state.activeAssistant) renderStoredMessage(message);
    finishActiveAssistant();
    return;
  }
  if (["tool_execution_start", "tool_call_start"].includes(eventType)) {
    const owner = ensureActiveAssistant();
    addTool(owner, event.toolCallId || event.id, event.toolName || event.name, event.args || event.arguments || event.input);
    return;
  }
  if (["tool_execution_update", "tool_call_update"].includes(eventType)) {
    updateTool(event.toolCallId || event.id, event.partialResult || event.result || event.update);
    return;
  }
  if (["tool_execution_end", "tool_call_end"].includes(eventType)) {
    finishTool(event.toolCallId || event.id, event.result, Boolean(event.isError || event.error));
  }
}

function handleMessageUpdate(event) {
  const update = event.assistantMessageEvent || event.update || event.event || event;
  const owner = ensureActiveAssistant();
  if (["text_delta", "output_text_delta"].includes(update.type)) {
    appendAssistantText(owner, update.delta || update.text || "");
  } else if (["thinking_delta", "reasoning_delta"].includes(update.type)) {
    appendThinking(owner, update.delta || update.text || "");
  } else if (["toolcall_start", "tool_call_start"].includes(update.type)) {
    addTool(owner, update.toolCallId || update.id, update.toolName || update.name, update.args || update.arguments);
  }
}

function ensureActiveAssistant() {
  if (!state.activeAssistant) {
    state.activeAssistant = appendMessage("assistant", "", { streaming: true });
  }
  return state.activeAssistant;
}

function appendMessage(role, text, options = {}) {
  elements.welcome.hidden = true;
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user" : "assistant"}`;
  if (options.id) article.dataset.messageId = options.id;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "You" : "H";

  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = role === "user" ? "You" : "Hopper";
  const status = document.createElement("span");
  status.className = "message-status";
  status.textContent = options.streaming ? "Working" : "";
  meta.append(author, status);

  const messageText = document.createElement("div");
  messageText.className = `message-text${options.streaming ? " stream-cursor" : ""}`;
  messageText.textContent = text || "";
  body.append(meta, messageText);

  if (options.thinking) appendThinking({ article, body, text: messageText, status }, options.thinking);

  const toolStack = document.createElement("div");
  toolStack.className = "tool-stack";
  body.append(toolStack);
  article.append(avatar, body);
  elements.conversation.append(article);
  scrollConversation();
  return { article, body, text: messageText, status, toolStack };
}

function appendAssistantText(owner, delta) {
  owner.text.textContent += delta;
  scrollConversation();
}

function appendThinking(owner, delta) {
  let details = owner.body.querySelector(".thinking-block");
  if (!details) {
    details = document.createElement("details");
    details.className = "thinking-block";
    const summary = document.createElement("summary");
    summary.textContent = "Thinking";
    const content = document.createElement("div");
    content.className = "thinking-text";
    details.append(summary, content);
    owner.body.insertBefore(details, owner.toolStack || null);
  }
  details.querySelector(".thinking-text").textContent += delta;
}

function finishActiveAssistant() {
  if (!state.activeAssistant) return;
  state.activeAssistant.text.classList.remove("stream-cursor");
  state.activeAssistant.status.textContent = "";
  state.activeAssistant = null;
}

function addTool(owner, id, name, args) {
  const toolId = id || `tool-${Date.now()}-${state.tools.size}`;
  if (state.tools.has(toolId)) return state.tools.get(toolId);

  const details = document.createElement("details");
  details.className = "tool-call";
  details.dataset.status = "running";
  const summary = document.createElement("summary");
  const toolName = document.createElement("span");
  toolName.className = "tool-name";
  toolName.textContent = name || "Tool call";
  const toolStatus = document.createElement("span");
  toolStatus.className = "tool-status";
  toolStatus.textContent = "Running";
  const detail = document.createElement("pre");
  detail.className = "tool-detail";
  detail.textContent = formatValue(args);
  summary.append(toolName, toolStatus);
  details.append(summary, detail);
  owner.toolStack.append(details);

  const record = { details, status: toolStatus, detail };
  state.tools.set(toolId, record);
  scrollConversation();
  return record;
}

function updateTool(id, value) {
  const tool = state.tools.get(id);
  if (!tool) return;
  const text = formatValue(value);
  if (text) tool.detail.textContent = text;
}

function finishTool(id, result, isError) {
  const tool = state.tools.get(id);
  if (!tool) return;
  tool.details.dataset.status = isError ? "error" : "complete";
  tool.status.textContent = isError ? "Failed" : "Complete";
  const text = formatValue(result);
  if (text) tool.detail.textContent = text;
  if (isError) tool.details.open = true;
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "No details";
  if (typeof value === "string") return value;
  if (Array.isArray(value?.content)) {
    const text = value.content.map((part) => part?.text || "").filter(Boolean).join("\n");
    if (text) return text;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function applyModels(payload) {
  const models = payload.models || payload.data?.models || [];
  const providers = payload.providers || payload.data?.providers || [];
  if (Array.isArray(models)) state.models = models;
  if (Array.isArray(providers)) state.providers = providers;

  const previousModel = payload.currentModel || payload.model || elements.modelSelect.value;
  elements.modelSelect.replaceChildren();
  if (!state.models.length) {
    elements.modelSelect.append(new Option("No authenticated models", ""));
  } else {
    const groups = new Map();
    for (const model of state.models) {
      const provider = model.provider || model.providerId || "Models";
      if (!groups.has(provider)) {
        const group = document.createElement("optgroup");
        group.label = providerLabel(provider);
        groups.set(provider, group);
        elements.modelSelect.append(group);
      }
      const id = model.id || model.modelId || model.value;
      const value = `${provider}/${id}`;
      const option = new Option(model.name || model.label || id, value);
      option.dataset.provider = provider;
      option.dataset.modelId = id;
      groups.get(provider).append(option);
    }
  }
  elements.modelSelect.disabled = !state.authenticated || !state.models.length;
  elements.thinkingSelect.disabled = !state.authenticated || !state.models.length;
  selectCurrentModel(previousModel);
  refreshProviderControls();
}

function handleUiStatus(message) {
  const text = message.text || "";
  if (message.key === "title" && text) elements.sessionTitle.textContent = text;
  if (message.key === "working") elements.runtimePill.textContent = text || (state.streaming ? "Working" : "Ready");
  if (message.key === "hopper-backend") {
    elements.backendDetail.dataset.state = text.includes("online") ? "online" : "offline";
  }
}

function handleUiWidget(message) {
  if (message.key === "hopper-backend") {
    const text = Array.isArray(message.lines) && message.lines.length
      ? message.lines.join(" ")
      : "Hopper/Rhino runtime unavailable";
    if (elements.backendDetail.textContent !== text) elements.backendDetail.textContent = text;
    return;
  }
  if (!Array.isArray(message.lines) || !message.lines.length) return;
  showToast(message.lines.join("\n"), "info");
}

function handleAuthEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "auth_url") {
    showAuthNotice(event.instructions || "Continue sign-in in your browser.", event.url, "Open sign-in");
    showLinkedToast(event.instructions || "Continue sign-in in your browser.", event.url, "Open sign-in");
    return;
  }
  if (event.type === "device_code") {
    const message = `Enter code ${event.userCode} to continue sign-in.`;
    showAuthNotice(message, event.verificationUri, "Open verification page");
    showLinkedToast(message, event.verificationUri, "Open verification page");
    return;
  }
  if (["info", "progress"].includes(event.type) && event.message) {
    const firstLink = Array.isArray(event.links) ? event.links[0] : null;
    showAuthNotice(event.message, firstLink?.url, firstLink?.label || "Open link");
    if (firstLink?.url) showLinkedToast(event.message, firstLink.url, firstLink.label || "Open link");
    else showToast(event.message, "info");
  }
}

function selectCurrentModel(model) {
  if (!model) return;
  const value = typeof model === "string"
    ? model
    : `${model.provider || model.providerId}/${model.id || model.modelId}`;
  const match = [...elements.modelSelect.options].find((option) => option.value === value || option.dataset.modelId === value);
  if (match) {
    elements.modelSelect.value = match.value;
    state.currentProvider = match.dataset.provider || match.value.split("/")[0];
    refreshProviderControls();
  }
}

function refreshProviderControls() {
  const providerOptions = state.providers.length
    ? state.providers
    : [...new Set(state.models.map((model) => model.provider || model.providerId).filter(Boolean))].map((id) => ({ id }));
  const selected = elements.providerSelect.value;
  if (providerOptions.length) {
    elements.providerSelect.replaceChildren();
    for (const provider of providerOptions) {
      const id = provider.id || provider.providerId;
      const option = new Option(provider.name || provider.label || providerLabel(id), id);
      elements.providerSelect.append(option);
    }
    if ([...elements.providerSelect.options].some((option) => option.value === selected)) {
      elements.providerSelect.value = selected;
    } else if (state.currentProvider) {
      elements.providerSelect.value = state.currentProvider;
    }
  }

  const active = state.providers.find((provider) => (provider.id || provider.providerId) === state.currentProvider);
  const connected = Boolean(active?.authenticated || active?.connected || active?.hasAuth);
  elements.providerState.textContent = connected ? "Connected" : state.models.length ? "Available" : "Not configured";
  elements.providerState.classList.toggle("connected", connected || state.models.length > 0);
  elements.providerSummary.textContent = state.currentProvider
    ? `${providerLabel(state.currentProvider)} is selected for this session.`
    : "Connect a model provider using Hopper's private settings.";
  elements.logoutButton.disabled = !(connected || state.models.some((model) => (model.provider || model.providerId) === elements.providerSelect.value));
}

function updateProviderStatus(message) {
  const provider = message.provider || message.providerId || state.currentProvider;
  const status = message.status || message.state;
  if (provider) state.currentProvider = provider;
  if (["authenticated", "connected", "ready", "logged_in"].includes(status)) {
    elements.accountNotice.hidden = true;
    elements.accountNotice.replaceChildren();
    elements.accountError.hidden = true;
    showToast(`${providerLabel(provider)} connected.`, "info");
    if (elements.accountDialog.open) elements.accountDialog.close();
  } else if (["logged_out", "disconnected"].includes(status)) {
    showToast(`${providerLabel(provider)} logged out.`, "info");
  }
  refreshProviderControls();
}

function handleError(message) {
  const text = message.message || message.error || "Hopper encountered an error.";
  if (
    message.scope === "auth" ||
    message.operation === "login" ||
    ["login", "logout"].includes(message.requestType) ||
    elements.accountDialog.open
  ) {
    elements.accountNotice.hidden = true;
    elements.accountError.textContent = text;
    elements.accountError.hidden = false;
    elements.loginButton.disabled = false;
  }
  showToast(text, "error");
}

function enqueueUiRequest(request) {
  state.uiQueue.push(request);
  if (!state.pendingUiRequest) showNextUiRequest();
}

function showNextUiRequest() {
  const request = state.uiQueue.shift();
  if (!request) return;
  state.pendingUiRequest = request;
  const requestKind = request.method || request.kind || request.uiType || "input";
  const method = requestKind === "auth" && Array.isArray(request.options) && request.options.length
    ? "select"
    : requestKind === "auth" ? "input" : requestKind;
  elements.uiTitle.textContent = request.title || request.question || titleCase(method);
  elements.uiDescription.textContent = request.message || request.description || "";
  elements.uiControl.replaceChildren();
  elements.uiSubmit.textContent = method === "confirm" ? "Confirm" : "Continue";

  if (method === "select") {
    const choices = document.createElement("div");
    choices.className = "choice-list";
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-label", request.title || request.question || "Choose an option");
    const options = request.options || [];
    options.forEach((option, index) => {
      const normalized = typeof option === "string" ? { label: option, value: option } : option;
      const label = document.createElement("label");
      label.className = "choice-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "ui-choice";
      input.value = normalized.id ?? normalized.value ?? normalized.label;
      input.checked = index === 0;
      const copy = document.createElement("span");
      const title = document.createElement("span");
      title.className = "choice-label";
      title.textContent = normalized.label ?? String(normalized.value);
      copy.append(title);
      if (normalized.description) {
        const description = document.createElement("span");
        description.className = "choice-description";
        description.textContent = normalized.description;
        copy.append(description);
      }
      label.append(input, copy);
      choices.append(label);
    });
    elements.uiControl.append(choices);
  } else if (method === "confirm") {
    const copy = document.createElement("p");
    copy.className = "confirm-copy";
    copy.textContent = request.message || request.description || request.title || "Continue?";
    elements.uiControl.append(copy);
  } else {
    const control = method === "editor" ? document.createElement("textarea") : document.createElement("input");
    control.className = method === "editor" ? "request-editor" : "request-input";
    control.name = "ui-value";
    control.setAttribute("aria-label", request.title || request.question || titleCase(method));
    control.placeholder = request.placeholder || "";
    control.value = request.prefill || request.value || "";
    if (request.secret && control instanceof HTMLInputElement) control.type = "password";
    control.required = method === "input";
    if (method === "editor") control.rows = 12;
    elements.uiControl.append(control);
  }

  elements.uiDialog.showModal();
  queueMicrotask(() => elements.uiControl.querySelector("input, textarea")?.focus());
}

function resolveUiRequest(cancelled = false) {
  const request = state.pendingUiRequest;
  if (!request) return;
  const requestKind = request.method || request.kind || request.uiType || "input";
  const method = requestKind === "auth" && Array.isArray(request.options) && request.options.length
    ? "select"
    : requestKind === "auth" ? "input" : requestKind;
  let result = null;
  if (!cancelled) {
    if (method === "select") result = elements.uiControl.querySelector("input:checked")?.value;
    else if (method === "confirm") result = true;
    else result = elements.uiControl.querySelector("[name='ui-value']")?.value ?? "";
  } else if (method === "confirm") {
    result = false;
  }
  send({
    type: "ui_response",
    requestId: request.requestId || request.id,
    value: cancelled ? (method === "confirm" ? false : null) : result,
  });
  state.pendingUiRequest = null;
  if (elements.uiDialog.open) elements.uiDialog.close();
  showNextUiRequest();
}

function setConnection(kind, label, detail) {
  elements.shell.dataset.connection = kind;
  elements.connectionLabel.textContent = label;
  elements.connectionDetail.textContent = detail;
  const ready = kind === "connected" && state.authenticated;
  elements.composerInput.disabled = !ready;
  elements.sendButton.disabled = !ready || !elements.composerInput.value.trim();
  elements.newSessionButton.disabled = !ready;
  elements.openAccountButton.disabled = !ready;
  elements.shutdownButton.disabled = !ready;
  elements.modelSelect.disabled = !ready || !state.models.length;
  elements.thinkingSelect.disabled = !ready || !state.models.length;
  elements.runtimePill.textContent = ready ? (state.streaming ? "Working" : "Ready") : label;
}

function setStreaming(streaming) {
  state.streaming = streaming;
  elements.stopButton.disabled = !streaming || !state.authenticated;
  elements.runtimePill.textContent = streaming ? "Working" : state.authenticated ? "Ready" : "Starting";
  if (streaming && elements.sendMode.value === "prompt") elements.sendMode.value = "follow_up";
  if (!streaming && elements.sendMode.value !== "prompt") elements.sendMode.value = "prompt";
}

function showBanner(text) {
  elements.connectionBannerText.textContent = text;
  elements.connectionBanner.hidden = false;
}

function hideBanner() {
  elements.connectionBanner.hidden = true;
}

function showToast(message, level = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${level}`;
  toast.setAttribute("role", level === "error" ? "alert" : "status");
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 6500);
}

function showLinkedToast(message, url, label) {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) {
    showToast(message, "info");
    return;
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  const copy = document.createElement("span");
  copy.textContent = message;
  const link = document.createElement("a");
  link.className = "toast-link";
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = label;
  toast.append(copy, link);
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 30000);
}

function showAuthNotice(message, url, label) {
  const safeUrl = safeExternalUrl(url);
  elements.accountNotice.replaceChildren();
  const copy = document.createElement("span");
  copy.textContent = message;
  elements.accountNotice.append(copy);
  if (safeUrl) {
    const link = document.createElement("a");
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = label;
    elements.accountNotice.append(link);
  }
  elements.accountNotice.hidden = false;
}

function safeExternalUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function scrollConversation() {
  requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
}

function resizeComposer() {
  elements.composerInput.style.height = "auto";
  elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 190)}px`;
  elements.sendButton.disabled = !state.authenticated || !elements.composerInput.value.trim();
}

function submitPrompt() {
  const text = elements.composerInput.value.trim();
  if (!text) return;
  const type = elements.sendMode.value;
  if (!send({ type, text })) return;
  appendMessage("user", text);
  elements.composerInput.value = "";
  resizeComposer();
  if (type === "prompt") setStreaming(true);
}

function providerLabel(id) {
  const names = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    "openai-codex": "OpenAI Codex",
    google: "Google",
  };
  return names[id] || titleCase(id || "Provider");
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt();
});

elements.composerInput.addEventListener("input", resizeComposer);
elements.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitPrompt();
  }
});

elements.stopButton.addEventListener("click", () => send({ type: "abort" }));
elements.mobileSettingsButton.addEventListener("click", () => {
  const open = elements.mobileSettingsButton.getAttribute("aria-expanded") !== "true";
  setMobileSettings(open);
});
elements.newSessionButton.addEventListener("click", () => {
  if (state.streaming && !window.confirm("Stop the current response and start a new session?")) return;
  send({ type: "new_session" });
});
elements.reconnectButton.addEventListener("click", reconnectNow);
elements.bannerReconnectButton.addEventListener("click", reconnectNow);
elements.runtimeStatusRefresh.addEventListener("click", () => void refreshRuntimeStatus());
elements.shutdownButton.addEventListener("click", () => {
  if (!window.confirm("Shut down this local Hopper host? Rhino can start it again with _HopperCode.")) return;
  state.intentionalClose = true;
  send({ type: "shutdown" });
});

elements.modelSelect.addEventListener("change", () => {
  const option = elements.modelSelect.selectedOptions[0];
  if (!option?.value) return;
  state.currentProvider = option.dataset.provider;
  send({ type: "set_model", provider: option.dataset.provider, id: option.dataset.modelId });
  refreshProviderControls();
});

elements.thinkingSelect.addEventListener("change", () => {
  send({ type: "set_thinking", level: elements.thinkingSelect.value });
});

for (const suggestion of document.querySelectorAll("[data-suggestion]")) {
  suggestion.addEventListener("click", () => {
    elements.composerInput.value = suggestion.dataset.suggestion;
    resizeComposer();
    elements.composerInput.focus();
  });
}

elements.openAccountButton.addEventListener("click", () => {
  setMobileSettings(false);
  if (!elements.loginButton.disabled) {
    elements.accountNotice.hidden = true;
    elements.accountNotice.replaceChildren();
  }
  elements.accountError.hidden = true;
  elements.apiKeyInput.value = "";
  if (state.currentProvider) elements.providerSelect.value = state.currentProvider;
  refreshProviderControls();
  elements.accountDialog.showModal();
});

elements.accountCancelButton.addEventListener("click", () => elements.accountDialog.close());
elements.accountDialog.addEventListener("close", () => {
  elements.apiKeyInput.value = "";
});
elements.authTypeSelect.addEventListener("change", () => {
  const needsKey = elements.authTypeSelect.value === "api_key";
  elements.apiKeyField.hidden = !needsKey;
  elements.apiKeyInput.required = needsKey;
});

elements.accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const provider = elements.providerSelect.value;
  const authType = elements.authTypeSelect.value;
  const apiKey = elements.apiKeyInput.value.trim();
  if (authType === "api_key" && !apiKey) {
    elements.accountError.textContent = "Enter an API key.";
    elements.accountError.hidden = false;
    return;
  }
  elements.accountError.hidden = true;
  elements.accountNotice.hidden = false;
  elements.accountNotice.textContent = authType === "oauth"
    ? "Starting browser sign-in…"
    : "Checking the API key…";
  elements.loginButton.disabled = true;
  const message = { type: "login", provider, authType };
  if (authType === "api_key") message.apiKey = apiKey;
  if (!send(message)) elements.loginButton.disabled = false;
  else elements.apiKeyInput.value = "";
});

elements.logoutButton.addEventListener("click", () => {
  const provider = elements.providerSelect.value;
  if (!provider || !window.confirm(`Log out of ${providerLabel(provider)} in Hopper?`)) return;
  send({ type: "logout", provider });
});

elements.uiForm.addEventListener("submit", (event) => {
  event.preventDefault();
  resolveUiRequest(false);
});
elements.uiCancel.addEventListener("click", () => resolveUiRequest(true));
elements.uiDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  resolveUiRequest(true);
});

window.addEventListener("online", reconnectNow);
document.addEventListener("click", (event) => {
  const sidebar = elements.mobileSettingsButton.closest(".sidebar");
  if (elements.mobileSettingsButton.getAttribute("aria-expanded") === "true" && !sidebar.contains(event.target)) {
    setMobileSettings(false);
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.mobileSettingsButton.getAttribute("aria-expanded") === "true") {
    setMobileSettings(false);
    elements.mobileSettingsButton.focus();
  }
});
window.addEventListener("beforeunload", () => {
  state.intentionalClose = true;
  stopRuntimeStatusPolling();
  state.socket?.close(1000, "Page closed");
});

resizeComposer();
connect();
