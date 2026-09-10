import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { serveStatic, validateStaticDirectory, handleUiApi } from "../server.js";
import { MAX_IMAGES, MAX_IMAGE_BASE64 } from "../protocol.js";
import {
	parseSharedBrowserCommand,
	type SharedBrowserCommand,
} from "./browser-protocol.js";

import type { HostRuntime } from "../pi-runtime.js";
import { createSnapshotSender } from "./snapshot-sender.js";

export interface SharedBrowserBackend {
	snapshot(): unknown;
	command(
		command: Exclude<SharedBrowserCommand, { type: "authenticate" }>,
	): Promise<unknown>;
	subscribe(listener: (event: unknown) => void): () => void;
}
export function createSharedBrowserServer(options: {
	backend: SharedBrowserBackend;
	browserCredential: string;
	staticDir: string;
	allowedDevOrigin?: string;
	register?: (request: unknown) => Promise<unknown>;
	registrationCredential?: string;
	onRegistrationError?: (error: unknown) => void;
	health?: () => unknown;
	uiRuntime?: () => HostRuntime | undefined;
	exportConversation?: (conversationId: string | null) => unknown;
}): { server: Server; close(): Promise<void> } {
	const staticDir = validateStaticDirectory(options.staticDir);
	const equal = (a: string, b: string) =>
		Buffer.byteLength(a) === Buffer.byteLength(b) &&
		timingSafeEqual(Buffer.from(a), Buffer.from(b));
	const server = createServer((request, response) => {
		const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (pathname === "/health" || pathname === "/api/shared/health") {
			response.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			});
			response.end(
				JSON.stringify(options.health?.() ?? { mode: "shared", ok: true }),
			);
			return;
		}
		if (pathname === "/api/shared/register") {
			const token =
				request.headers.authorization?.replace(/^Bearer /, "") ?? "";
			if (
				!options.registrationCredential ||
				!equal(token, options.registrationCredential) ||
				request.method !== "POST" ||
				!options.register
			) {
				response.writeHead(403);
				response.end();
				return;
			}
			void (async () => {
				const chunks: Buffer[] = [];
				let length = 0;
				for await (const chunk of request) {
					length += chunk.length;
					if (length > 65_536) throw new Error("Registration too large");
					chunks.push(chunk);
				}
				const result = await options.register!(
					JSON.parse(Buffer.concat(chunks).toString("utf8")),
				);
				response.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				});
				response.end(JSON.stringify(result));
			})().catch((error) => {
				options.onRegistrationError?.(error);
				response.writeHead(400);
				response.end(
					JSON.stringify({
						error:
							error instanceof Error ? error.message : "Registration failed",
					}),
				);
			});
			return;
		}
		const uiRuntime = options.uiRuntime?.();
		if (uiRuntime && handleUiApi(request, response, { runtime: uiRuntime, token: options.browserCredential, exportSession: options.exportConversation })) return;
		serveStatic(staticDir, request, response);
	});
	const sockets = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_IMAGES * MAX_IMAGE_BASE64 + 1_048_576,
	});
	let controller: WebSocket | undefined;
	const snapshotSenders = new WeakMap<WebSocket, ReturnType<typeof createSnapshotSender>>();
	const send = (socket: WebSocket, event: unknown) => {
		if (socket.readyState !== WebSocket.OPEN) return;
		if ((event as { type?: string })?.type === "shared_snapshot")
			snapshotSenders.get(socket)?.push(event);
		else
			socket.send(JSON.stringify(event));
	};
	let unsubscribe: (() => void) | undefined;
	server.on("upgrade", (request, socket, head) => {
		const address = server.address();
		const origin =
			typeof address === "object" && address
				? `http://127.0.0.1:${address.port}`
				: "";
		if (
			request.url !== "/ws-shared" ||
			(request.headers.origin !== origin &&
				(!options.allowedDevOrigin ||
					request.headers.origin !== options.allowedDevOrigin))
		) {
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		sockets.handleUpgrade(request, socket, head, (ws) =>
			sockets.emit("connection", ws),
		);
	});
	sockets.on("connection", (socket: WebSocket) => {
		const snapshots = createSnapshotSender((event, done) => {
			if (socket.readyState !== WebSocket.OPEN) return done(new Error("Browser disconnected"));
			socket.send(JSON.stringify(event), done);
		});
		snapshotSenders.set(socket, snapshots);
		let authenticated = false;
		const timeout = setTimeout(
			() => socket.close(4003, "Authentication timed out"),
			5000,
		);
		timeout.unref();
		socket.on("close", () => {
			snapshots.close();
			clearTimeout(timeout);
			if (controller === socket) {
				controller = undefined;
				unsubscribe?.();
				unsubscribe = undefined;
			}
		});
		socket.on("message", (raw) => {
			let command: SharedBrowserCommand;
			try {
				command = parseSharedBrowserCommand(raw.toString());
			} catch (error) {
				let requestId: string | undefined;
				try {
					const rawCommand = JSON.parse(raw.toString());
					if (typeof rawCommand?.requestId === "string")
						requestId = rawCommand.requestId;
				} catch {}
				send(socket, {
					type: "error",
					requestId,
					message: error instanceof Error ? error.message : "Invalid command",
				});
				return;
			}
			if (!authenticated) {
				if (
					command.type !== "authenticate" ||
					!equal(command.token, options.browserCredential)
				) {
					socket.close(4003, "Authentication failed");
					return;
				}
				let snapshot: unknown;
				try {
					snapshot = options.backend.snapshot();
				} catch {
					socket.close(1013, "Host is initializing; retry shortly");
					return;
				}
				authenticated = true;
				clearTimeout(timeout);
				controller?.close(4001, "Replaced by another Hopper tab");
				controller = socket;
				unsubscribe?.();
				unsubscribe = options.backend.subscribe((event) => send(socket, event));
				send(socket, { type: "shared_snapshot", snapshot });
				return;
			}
			if (controller !== socket) {
				socket.close(4001, "Replaced by another Hopper tab");
				return;
			}
			if (command.type === "authenticate") {
				send(socket, { type: "error", message: "Already authenticated" });
				return;
			}
			const requestId = "requestId" in command ? command.requestId : undefined;
			void options.backend.command(command).then(
				(result) => {
					send(socket, { type: "command_accepted", requestId, result });
				},
				(error) =>
					send(socket, {
						type: "error",
						requestId,
						message: error instanceof Error ? error.message : "Command failed",
					}),
			);
		});
	});
	return {
		server,
		close: async () => {
			unsubscribe?.();
			unsubscribe = undefined;
			for (const socket of sockets.clients) socket.terminate();
			await new Promise<void>((resolve) => sockets.close(() => resolve()));
			if (server.listening)
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
		},
	};
}
