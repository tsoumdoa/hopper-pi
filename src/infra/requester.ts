import { type ConnectionConfig, resolveConnection, withConnectionToken } from "./connection.js";

export type RequestPhase = "connect" | "send" | "receive";

export class RequestTransportError extends Error {
	constructor(
		message: string,
		public readonly phase: RequestPhase,
		public readonly mutationInFlight: boolean,
		public readonly kind: "timeout" | "aborted" | "transport" | "malformed",
	) {
		super(message);
		this.name = "RequestTransportError";
	}
}

export type RequestOptions = {
	signal?: AbortSignal;
	timeoutMs?: number;
	mutates?: boolean;
};

export class Requester {
	private socket: import("zeromq").Request | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(options: { refresh?: boolean } = {}): Promise<void> {
		try {
			const { Request } = await import("zeromq");
			this.connection = resolveConnection(options);
			this.socket = new Request();
			this.socket.linger = 0;
			await this.socket.connect(this.connection.reqEndpoint);
		} catch {
			await this.close();
			throw new RequestTransportError("Backend connection failed", "connect", false, "transport");
		}
	}

	async request<T>(data: unknown, options: RequestOptions = {}): Promise<T> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		if (!this.connection) {
			throw new Error("Requester connection not resolved");
		}
		const payload = JSON.stringify(withConnectionToken(data, this.connection));
		const timeoutMs = options.timeoutMs ?? 30_000;
		let mutationInFlight = false;

		try {
			if (options.signal?.aborted) {
				throw new RequestTransportError("Request interrupted", "send", false, "aborted");
			}

			// A mutating request becomes uncertain as soon as socket send begins.
			mutationInFlight = options.mutates === true;
			await bounded(this.socket.send(payload), {
				signal: options.signal,
				timeoutMs,
				phase: "send",
				mutationInFlight,
			});

			const [response] = await bounded(this.socket.receive(), {
				signal: options.signal,
				timeoutMs,
				phase: "receive",
				mutationInFlight,
			});

			try {
				return parseJsonResponse<T>(response.toString());
			} catch {
				throw new RequestTransportError(
					"Backend returned malformed JSON",
					"receive",
					mutationInFlight,
					"malformed",
				);
			}
		} catch (error) {
			await this.close();
			if (error instanceof RequestTransportError) throw error;
			throw new RequestTransportError(
				"Backend request failed",
				mutationInFlight ? "receive" : "send",
				mutationInFlight,
				"transport",
			);
		}
	}

	async close(): Promise<void> {
		if (this.socket) {
			await this.socket.close();
			this.socket = null;
		}
		this.connection = null;
	}
}

async function bounded<T>(
	promise: Promise<T>,
	options: {
		signal?: AbortSignal;
		timeoutMs: number;
		phase: RequestPhase;
		mutationInFlight: boolean;
	},
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abortHandler: (() => void) | undefined;
	const guards: Promise<never>[] = [
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new RequestTransportError(
				`Backend ${options.phase} timed out`,
				options.phase,
				options.mutationInFlight,
				"timeout",
			)), options.timeoutMs);
		}),
	];
	if (options.signal) {
		guards.push(new Promise((_, reject) => {
			abortHandler = () => reject(new RequestTransportError(
				"Request interrupted",
				options.phase,
				options.mutationInFlight,
				"aborted",
			));
			options.signal!.addEventListener("abort", abortHandler, { once: true });
		}));
	}

	try {
		return await Promise.race([promise, ...guards]);
	} finally {
		if (timer) clearTimeout(timer);
		if (abortHandler && options.signal) {
			options.signal.removeEventListener("abort", abortHandler);
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
