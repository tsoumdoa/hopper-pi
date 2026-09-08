import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

/** Independent of the Rhino connection profile, project, Pi auth, and host sessions. */
export function toolPolicyProfileDirectory(options: {
	platform?: NodeJS.Platform;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	configDirectory?: string;
} = {}): string {
	if (options.configDirectory !== undefined) {
		if (!isAbsolute(options.configDirectory)) throw new Error("Tool configuration directory must be absolute");
		return normalize(options.configDirectory);
	}
	const platform = options.platform ?? process.platform;
	const home = options.homeDir ?? homedir();
	const env = options.env ?? process.env;
	if (platform === "darwin") return join(home, "Library", "Application Support", "hopper-pi");
	if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "hopper-pi");
	const configHome = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
	return join(configHome, "hopper-pi");
}
