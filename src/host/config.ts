import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const LOOPBACK_HOST = "127.0.0.1";

export type HostPaths = {
	dataDir: string;
	agentDir: string;
	sessionsDir: string;
	workspaceDir: string;
	staticDir: string;
};

export type HostConfig = {
	host: typeof LOOPBACK_HOST;
	port: number;
	instanceId: string;
	parentPid?: number;
	connectionProfile?: string;
	paths: HostPaths;
};

export type HostConfigEnvironment = {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	cwd?: string;
	moduleDir?: string;
};

function readOption(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function parseInteger(value: string | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is out of range`);
	return parsed;
}

export function defaultDataDirectory(options: HostConfigEnvironment = {}): string {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const userHome = options.homeDir ?? homedir();

	if (platform === "win32") {
		return join(env.APPDATA || join(userHome, "AppData", "Roaming"), "hopper-pi", "host");
	}
	if (platform === "darwin") {
		return join(userHome, "Library", "Application Support", "hopper-pi", "host");
	}
	return join(env.XDG_DATA_HOME || join(userHome, ".local", "share"), "hopper-pi", "host");
}

export function resolveHostConfig(
	args: readonly string[],
	options: HostConfigEnvironment = {},
): HostConfig {
	const cwd = options.cwd ?? process.cwd();
	const moduleDir = options.moduleDir ?? cwd;
	const dataDirArg = readOption(args, "--data-dir");
	const staticDirArg = readOption(args, "--static-dir");
	const profileArg = readOption(args, "--connection-profile");
	const instanceId = readOption(args, "--instance-id") ?? "standalone";
	const port = parseInteger(readOption(args, "--port"), "--port") ?? 0;
	const parentPid = parseInteger(readOption(args, "--parent-pid"), "--parent-pid");

	if (port < 0 || port > 65_535) throw new Error("--port must be between 0 and 65535");
	if (parentPid !== undefined && parentPid < 1) throw new Error("--parent-pid must be positive");
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)) {
		throw new Error("--instance-id must contain only letters, numbers, underscores, or hyphens");
	}

	const absolute = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
	const dataDir = dataDirArg ? absolute(dataDirArg) : defaultDataDirectory(options);
	const instanceDir = join(dataDir, "instances", instanceId);

	return {
		host: LOOPBACK_HOST,
		port,
		instanceId,
		parentPid,
		connectionProfile: profileArg ? absolute(profileArg) : undefined,
		paths: {
			dataDir,
			agentDir: join(dataDir, "agent"),
			sessionsDir: join(instanceDir, "sessions"),
			workspaceDir: join(instanceDir, "workspace"),
			staticDir: staticDirArg ? absolute(staticDirArg) : resolve(moduleDir, "static"),
		},
	};
}
