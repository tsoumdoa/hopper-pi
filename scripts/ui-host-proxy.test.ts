import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { expect, it } from "vitest";
import { sharedHostProxy } from "./ui-host-proxy.js";

it("discovers a host started after Vite for both APIs and WebSocket reconnects", async () => {
	let target = "http://127.0.0.1:1";
	const host = createServer((_request, response) => response.end("shared host"));
	const sockets = new WebSocketServer({ server: host });
	sockets.on("connection", (socket) => socket.send("shared snapshot"));
	const vite = await createViteServer({
		configFile: false, root: "/tmp", logLevel: "silent",
		server: { host: "127.0.0.1", port: 0, proxy: { "/api": sharedHostProxy(() => target), "/ws": sharedHostProxy(() => target) } },
	});
	try {
		await vite.listen();
		const port = (vite.httpServer!.address() as { port: number }).port;
		expect((await fetch(`http://127.0.0.1:${port}/api/shared/health`)).status).toBe(502);
		await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
		target = `http://127.0.0.1:${(host.address() as { port: number }).port}`;
		expect(await (await fetch(`http://127.0.0.1:${port}/api/shared/health`)).text()).toBe("shared host");
		for (let reconnect = 0; reconnect < 2; reconnect++) {
			const socket = new WebSocket(`ws://127.0.0.1:${port}/ws-shared`);
			try {
				const message = await new Promise<string>((resolve, reject) => {
					socket.once("message", (message) => resolve(message.toString()));
					socket.once("error", reject);
				});
				expect(message).toBe("shared snapshot");
			} finally { socket.terminate(); }
		}
	} finally {
		for (const socket of sockets.clients) socket.terminate();
		await new Promise<void>((resolve) => sockets.close(() => resolve()));
		await new Promise<void>((resolve) => host.close(() => resolve()));
		await vite.close();
	}
}, 15_000);
