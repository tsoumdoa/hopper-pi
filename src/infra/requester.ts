import { type ConnectionConfig, resolveConnection, withConnectionToken } from "./connection.js";
import { REQUEST_TIMEOUT_MS } from "../config.js";

export class Requester {
	private socket: import("zeromq").Request | null = null;
	private connection: ConnectionConfig | null = null;

	async connect(options: { refresh?: boolean } = {}): Promise<void> {
		const { Request } = await import("zeromq");
		this.connection = resolveConnection(options);
		this.socket = new Request();
		await this.socket.connect(this.connection.reqEndpoint);
	}

	async request<T>(data: unknown): Promise<T> {
		if (!this.socket) {
			throw new Error("Requester not connected");
		}
		if (!this.connection) {
			throw new Error("Requester connection not resolved");
		}
		const payload = JSON.stringify(withConnectionToken(data, this.connection));

		await this.socket.send(payload);

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timeoutPromise = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
				}, REQUEST_TIMEOUT_MS);
			});

			const [response] = await Promise.race([
				this.socket.receive(),
				timeoutPromise,
			]);

			return parseJsonResponse<T>(response.toString());
		} catch (err) {
			if (err instanceof Error && err.message.includes("Request timed out")) {
				await this.close();
			}
			throw err;
		} finally {
			if (timer) clearTimeout(timer);
		}
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
