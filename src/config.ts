/** Shared CLI and backend connection configuration. */

export const ENV = {
	GH_DEBUG: "GH_DEBUG",
	GH_ZMQ_PUB: "GH_ZMQ_PUB",
	GH_ZMQ_PUSH: "GH_ZMQ_PUSH",
	GH_ZMQ_REQ: "GH_ZMQ_REQ",
	GH_ZMQ_TOKEN: "GH_ZMQ_TOKEN",
	HOPPER_CONNECTION_PROFILE: "HOPPER_CONNECTION_PROFILE",
} as const;

export const DEFAULT_ZMQ_ENDPOINTS = {
	pub: "tcp://127.0.0.1:5555",
	push: "tcp://127.0.0.1:5556",
	req: "tcp://127.0.0.1:5557",
} as const;

export const PROBE_TIMEOUT_MS = 8_000;
export const BACKEND_POLL_INTERVAL_MS = 3_000;
export const MAX_RHINO_OBJECT_IDS = 30;

export const DEBUG = process.env[ENV.GH_DEBUG] === "1";
