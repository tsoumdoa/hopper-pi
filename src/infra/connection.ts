import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ConnectionConfig = {
	pubEndpoint: string;
	pushEndpoint: string;
	reqEndpoint: string;
	token?: string;
	source: "env" | "profile" | "defaults";
	profilePath: string;
	instanceId?: string;
	startedAt?: number;
};

type ConnectionProfile = {
	protocolVersion?: number;
	instanceId?: string;
	pubEndpoint?: string;
	pushEndpoint?: string;
	reqEndpoint?: string;
	token?: string;
	startedAt?: number;
};

import { DEBUG, DEFAULT_ZMQ_ENDPOINTS, ENV } from "../config.js";

export { DEBUG };

let cachedConnection: ConnectionConfig | null = null;

export function clearConnectionCache(): void {
	cachedConnection = null;
}

export function connectionProfileDirectory(): string {
	if (process.env[ENV.HOPPER_CONNECTION_PROFILE]) {
		return dirname(process.env[ENV.HOPPER_CONNECTION_PROFILE]!);
	}

	if (process.platform === "win32" && process.env.APPDATA) {
		return join(process.env.APPDATA, "hopper-pi");
	}

	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support", "hopper-pi");
	}

	const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	return join(dataHome, "hopper-pi");
}

export function connectionProfilePath(): string {
	if (process.env[ENV.HOPPER_CONNECTION_PROFILE]) {
		return process.env[ENV.HOPPER_CONNECTION_PROFILE]!;
	}

	return join(connectionProfileDirectory(), "connection.json");
}

export function resolveConnection(options: { refresh?: boolean } = {}): ConnectionConfig {
	if (!options.refresh && cachedConnection) {
		return cachedConnection;
	}

	const profilePath = connectionProfilePath();
	const profileDir = connectionProfileDirectory();
	const profile = readProfile(profilePath);
	const hasEndpointEnv =
		Boolean(process.env[ENV.GH_ZMQ_PUB]) ||
		Boolean(process.env[ENV.GH_ZMQ_PUSH]) ||
		Boolean(process.env[ENV.GH_ZMQ_REQ]);
	const hasTokenEnv = Boolean(process.env[ENV.GH_ZMQ_TOKEN]);

	const connection: ConnectionConfig = {
		pubEndpoint:
			process.env[ENV.GH_ZMQ_PUB] ||
			profile?.pubEndpoint ||
			DEFAULT_ZMQ_ENDPOINTS.pub,
		pushEndpoint:
			process.env[ENV.GH_ZMQ_PUSH] ||
			profile?.pushEndpoint ||
			DEFAULT_ZMQ_ENDPOINTS.push,
		reqEndpoint:
			process.env[ENV.GH_ZMQ_REQ] ||
			profile?.reqEndpoint ||
			DEFAULT_ZMQ_ENDPOINTS.req,
		token:
			process.env[ENV.GH_ZMQ_TOKEN] ||
			profile?.token ||
			readTokenFile(profileDir),
		source: hasEndpointEnv || hasTokenEnv ? "env" : profile ? "profile" : "defaults",
		profilePath,
		instanceId: profile?.instanceId,
		startedAt: profile?.startedAt,
	};

	cachedConnection = connection;
	return connection;
}

export function formatEndpoint(endpoint: string): string {
	return endpoint.replace(/^tcp:\/\//, "");
}

export function withConnectionToken<T>(data: T, connection: ConnectionConfig): T {
	if (
		!connection.token ||
		data === null ||
		typeof data !== "object" ||
		Array.isArray(data)
	) {
		return data;
	}

	return {
		...data,
		token: connection.token,
	};
}

function readTokenFile(profileDir: string): string | undefined {
	const tokenPath = join(profileDir, "connection-token");
	if (!existsSync(tokenPath)) {
		return undefined;
	}

	try {
		const token = readFileSync(tokenPath, "utf8").trim();
		return token || undefined;
	} catch {
		return undefined;
	}
}

function readProfile(profilePath: string): ConnectionProfile | null {
	if (!existsSync(profilePath)) {
		return null;
	}

	try {
		const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as ConnectionProfile;
		if (
			typeof parsed.pubEndpoint !== "string" ||
			typeof parsed.pushEndpoint !== "string" ||
			typeof parsed.reqEndpoint !== "string"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}
