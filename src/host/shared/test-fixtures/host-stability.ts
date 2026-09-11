import { createSharedBrowserServer } from "../browser-server.js";
import { createHostShutdown, monitorHostLifetime } from "../lifetime.js";
import { TaskJournal } from "../journal.js";
import { SharedTaskService } from "../task-service.js";

const [mode, directory, journalPath] = process.argv.slice(2);
const browser = createSharedBrowserServer({
	staticDir: directory!, browserCredential: "secret",
	backend: { snapshot: () => ({ ready: true }), command: async () => null, subscribe: () => () => {} },
});
await new Promise<void>(resolve => browser.server.listen(0, "127.0.0.1", resolve));
let journal: TaskJournal | undefined;
let tasks: SharedTaskService | undefined;
let taskId: string | undefined;
if (mode !== "socket") {
	journal = new TaskJournal(journalPath!);
	const chat = journal.createConversation("chat", "Chat");
	tasks = new SharedTaskService(journal, {
		resolveBinding: () => ({ processKey: "p", attachmentGeneration: "g" }), validateBinding: () => {},
		createDriver: () => ({
			run: () => new Promise<void>(() => {}),
			steer: async () => {},
			cancel: () => mode === "cancel" ? new Promise<void>(() => {}) : undefined,
			cleanup: async () => ({ confirmed: true }),
		}),
	});
	taskId = tasks.submit({ ...chat, requestId: "task", kind: "prompt", text: "Edit", bindings: [], attachments: [] }).taskId;
	await new Promise(resolve => setImmediate(resolve));
}
let stopMonitor: (() => void) | undefined;
const close = createHostShutdown({
	cleanup: async () => { stopMonitor?.(); await tasks?.stop(); await browser.close(); journal?.close(); },
	exit: code => process.exit(code), log: message => process.stderr.write(message + "\n"),
});
process.once("SIGTERM", () => { void close(); });
process.on("message", message => {
	if (message === "stop") void close();
	if (message === "lifetime") stopMonitor = monitorHostLifetime({ shouldStop: () => true, close, log: () => {} });
});
process.send!({ port: (browser.server.address() as { port: number }).port, taskId });
