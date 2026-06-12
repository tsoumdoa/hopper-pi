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

const DEFAULT_PUB_ENDPOINT = "tcp://127.0.0.1:5555";
const DEFAULT_PUSH_ENDPOINT = "tcp://127.0.0.1:5556";
const DEFAULT_REQ_ENDPOINT = "tcp://127.0.0.1:5557";

export const DEBUG = process.env.GH_DEBUG === "1";

let cachedConnection: ConnectionConfig | null = null;

export function clearConnectionCache(): void {
	cachedConnection = null;
}

export function connectionProfileDirectory(): string {
	if (process.env.HOPPER_CONNECTION_PROFILE) {
		return dirname(process.env.HOPPER_CONNECTION_PROFILE);
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
	if (process.env.HOPPER_CONNECTION_PROFILE) {
		return process.env.HOPPER_CONNECTION_PROFILE;
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
		Boolean(process.env.GH_ZMQ_PUB) ||
		Boolean(process.env.GH_ZMQ_PUSH) ||
		Boolean(process.env.GH_ZMQ_REQ);
	const hasTokenEnv = Boolean(process.env.GH_ZMQ_TOKEN);

	const connection: ConnectionConfig = {
		pubEndpoint:
			process.env.GH_ZMQ_PUB ||
			profile?.pubEndpoint ||
			DEFAULT_PUB_ENDPOINT,
		pushEndpoint:
			process.env.GH_ZMQ_PUSH ||
			profile?.pushEndpoint ||
			DEFAULT_PUSH_ENDPOINT,
		reqEndpoint:
			process.env.GH_ZMQ_REQ ||
			profile?.reqEndpoint ||
			DEFAULT_REQ_ENDPOINT,
		token:
			process.env.GH_ZMQ_TOKEN ||
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
