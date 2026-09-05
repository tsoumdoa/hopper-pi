import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ENV } from "../config.js";

export type ConnectionConfig = {
	rpcEndpoint: string;
	pubEndpoint: string;
	token: string;
	lifecycleInstanceId: string;
	profilePath: string;
	source: "profile";
};

type ConnectionProfile = {
	protocolVersion?: number;
	lifecycleInstanceId?: string;
	endpoints?: {
		rpcEndpoint?: string;
		pubEndpoint?: string;
	};
	authentication?: {
		token?: string;
	};
};

export const DEBUG = process.env[ENV.GH_DEBUG] === "1";

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
	return process.env[ENV.HOPPER_CONNECTION_PROFILE]
		?? join(connectionProfileDirectory(), "connection.json");
}

export function resolveConnection(options: { refresh?: boolean } = {}): ConnectionConfig {
	if (!options.refresh && cachedConnection) return cachedConnection;

	const profilePath = connectionProfilePath();
	const profile = readProfile(profilePath);
	if (!profile) {
		throw new Error(`RPC v2 connection profile is missing or invalid: ${profilePath}`);
	}

	const connection: ConnectionConfig = {
		rpcEndpoint: profile.endpoints!.rpcEndpoint!,
		pubEndpoint: profile.endpoints!.pubEndpoint!,
		token: profile.authentication!.token!,
		lifecycleInstanceId: profile.lifecycleInstanceId!,
		profilePath,
		source: "profile",
	};
	cachedConnection = connection;
	return connection;
}

export function formatEndpoint(endpoint: string): string {
	return endpoint.replace(/^tcp:\/\//, "");
}

function readProfile(profilePath: string): ConnectionProfile | null {
	if (!existsSync(profilePath)) return null;

	try {
		const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as ConnectionProfile;
		if (
			parsed.protocolVersion !== 2
			|| !isIdentifier(parsed.lifecycleInstanceId)
			|| typeof parsed.endpoints?.rpcEndpoint !== "string"
			|| parsed.endpoints.rpcEndpoint.length === 0
			|| typeof parsed.endpoints.pubEndpoint !== "string"
			|| parsed.endpoints.pubEndpoint.length === 0
			|| typeof parsed.authentication?.token !== "string"
			|| !/^[A-Za-z0-9_-]{32,128}$/.test(parsed.authentication.token)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function isIdentifier(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
