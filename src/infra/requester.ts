import { type ConnectionConfig, resolveConnection, withConnectionToken } from "./connection.js";

export class Requester {
	private socket: import("zeromq").Request | null = null;
	private connection: ConnectionConfig | null = null;

	constructor(private readonly defaultSignal?: AbortSignal) {}

	async connect(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<void> {
		const signal = options.signal ?? this.defaultSignal;
		signal?.throwIfAborted();
		const { Request } = await import("zeromq");
		signal?.throwIfAborted();
		this.connection = resolveConnection(options);
		this.socket = new Request();
		try {
			await this.socket.connect(this.connection.reqEndpoint);
			signal?.throwIfAborted();
		} catch (error) {
			await this.close();
			throw error;
		}
	}

	async request<T>(data: unknown, signal = this.defaultSignal): Promise<T> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		if (!this.connection) {
			throw new Error("Requester connection not resolved");
		}
		signal?.throwIfAborted();
		const payload = JSON.stringify(withConnectionToken(data, this.connection));

		await this.socket.send(payload);
		signal?.throwIfAborted();

		const socket = this.socket;
		const receive = socket.receive();
		const [response] = signal
			? await new Promise<Awaited<typeof receive>>((resolve, reject) => {
				const onAbort = () => {
					if (this.socket === socket) this.socket = null;
					void socket.close();
					reject(new DOMException("The operation was aborted", "AbortError"));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				receive.then(resolve, reject).finally(() => {
					signal.removeEventListener("abort", onAbort);
				});
			})
			: await receive;

		return parseJsonResponse<T>(response.toString());
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
	}
}

function parseJsonResponse<T>(raw: string): T {
	const parsed: unknown = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid response: expected JSON object");
	}
	return parsed as T;
}
