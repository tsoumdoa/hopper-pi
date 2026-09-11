import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { win32 } from "node:path";

export interface RhinoProcessIdentity {
	pid: number;
	startIdentity: string;
	executable: string;
}
export interface RhinoProcessAdapter {
	inspect(pid: number): Promise<RhinoProcessIdentity | null>;
	spawn(executable: string, onSpawn: (pid: number) => void): Promise<RhinoProcessIdentity>;
}
export class RhinoNotStartedError extends Error {}
// Rhino parses the quoted macro from its raw command line, even when it has no spaces.
export const WINDOWS_RHINO_ARGUMENTS = ["/nosplash", "/notemplate", '/runscript="_HopperCode"'] as const;
const run = promisify(execFile);

/** Query the actual process, including its precise .NET start time; never accept an agent-supplied path. */
export async function inspectWindowsRhino(pid: number): Promise<RhinoProcessIdentity | null> {
	if (process.platform !== "win32" || !Number.isSafeInteger(pid) || pid < 1)
		throw new Error("Expected a Windows process ID");
	const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
		`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $p) { @{pid=$p.Id; startIdentity=$p.StartTime.ToUniversalTime().ToString('O'); executable=$p.Path} | ConvertTo-Json -Compress }`,
	], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
	if (!stdout.trim()) return null;
	const value = JSON.parse(stdout) as RhinoProcessIdentity;
	if (value.pid !== pid || !value.startIdentity || !value.executable ||
		!win32.isAbsolute(value.executable) || win32.basename(value.executable).toLowerCase() !== "rhino.exe")
		throw new Error("Process is not an inspectable Rhino installation");
	return value;
}

export const windowsRhinoProcess: RhinoProcessAdapter = {
	inspect: inspectWindowsRhino,
	async spawn(executable, onSpawn) {
		const child = spawn(executable, [...WINDOWS_RHINO_ARGUMENTS], {
			detached: true, stdio: "ignore", shell: false, windowsHide: false, windowsVerbatimArguments: true,
			cwd: win32.dirname(executable), env: { ...process.env, HOPPER_RHINO_WORKER: "1" },
		});
		const pid = await new Promise<number>((resolve, reject) => {
			child.once("error", error => reject(new RhinoNotStartedError(error.message)));
			child.once("spawn", () => {
				child.unref();
				try { onSpawn(child.pid!); resolve(child.pid!); } catch (error) { reject(error); }
			});
		});
		const identity = await inspectWindowsRhino(pid);
		if (!identity) throw new Error("Rhino exited before its process identity could be recorded");
		return identity;
	},
};
