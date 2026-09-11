import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => mocks);
import { inspectWindowsRhino, windowsRhinoProcess, RhinoNotStartedError } from "./windows-rhino-process.js";

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
it("launches a visible Rhino with fixed startup arguments, a private startup flag, and no shell", async () => {
	vi.spyOn(process, "platform", "get").mockReturnValue("win32");
	const executable = "C:\\Program Files\\Rhino 8\\System\\Rhino.exe";
	const child = Object.assign(new EventEmitter(), { pid: 202, unref: vi.fn() });
	mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("spawn")); return child; });
	mocks.execFile.mockImplementation((_command, _args, _options, callback) => callback(null, { stdout: JSON.stringify({ pid: 202, startIdentity: "2026-09-11T00:00:00.1234567Z", executable }) }));
	// promisify(execFile) uses the native custom return shape; this mock returns that shape directly.
	const onSpawn = vi.fn();
	await expect(windowsRhinoProcess.spawn(executable, onSpawn)).resolves.toMatchObject({ pid: 202 });
	expect(mocks.spawn).toHaveBeenCalledWith(executable, ["/nosplash", "/notemplate", '/runscript="_HopperCode"'], expect.objectContaining({
		shell: false, windowsHide: false, windowsVerbatimArguments: true, detached: true, stdio: "ignore", env: expect.objectContaining({ HOPPER_RHINO_WORKER: "1" }),
	}));
	expect(onSpawn).toHaveBeenCalledWith(202);
	expect(child.unref).toHaveBeenCalledOnce();
	expect(process.env.HOPPER_RHINO_WORKER).toBeUndefined();
});

it("reports a failed OS spawn as definitely not started", async () => {
	const child = new EventEmitter();
	mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("error", new Error("ENOENT"))); return child; });
	await expect(windowsRhinoProcess.spawn("C:\\Rhino.exe", vi.fn())).rejects.toBeInstanceOf(RhinoNotStartedError);
});

it("never interpolates an unvalidated PID into PowerShell", async () => {
	vi.spyOn(process, "platform", "get").mockReturnValue("win32");
	await expect(inspectWindowsRhino("1; Write-Output bad" as unknown as number)).rejects.toThrow("process ID");
	expect(mocks.execFile).not.toHaveBeenCalled();
});
