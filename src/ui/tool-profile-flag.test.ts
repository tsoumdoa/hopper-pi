import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager } from "@earendil-works/pi-coding-agent";
import { createHopperPiExtension } from "../index.js";
import { toolPolicyForSession } from "../services/tool-policy-runtime.js";

const profile = vi.hoisted(() => ({ defaultDirectory: "" }));
vi.mock("../services/tool-policy-profile.js", () => ({
	toolPolicyProfileDirectory: (options: { configDirectory?: string } = {}) => options.configDirectory ?? profile.defaultDirectory,
}));
vi.mock("../infra/backend-status.js", () => ({
	probeBackend: vi.fn(async () => ({ online: false })), getCachedBackendStatus: vi.fn(() => ({ online: false })), refreshBackendIfOffline: vi.fn(async () => false),
}));
vi.mock("../ui/backend-status.js", () => ({ registerBackendStatusUI: vi.fn() }));
vi.mock("../ui/tool-schemas.js", () => ({ registerToolSchemasUI: vi.fn() }));

it("resolves CLI profile flags after factory loading without writing the default profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-profile-flag-"));
	profile.defaultDirectory = join(root, "default-profile");
	const configuredDirectory = join(root, "selected-profile");
	const sessionManager = SessionManager.inMemory(root);
	let session: Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"] | undefined;
	try {
		const services = await createAgentSessionServices({
			cwd: root, agentDir: join(root, "agent"), extensionFlagValues: new Map([["hopper-config-dir", configuredDirectory]]),
			resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
				extensionFactories: [{ name: "hopper", factory: createHopperPiExtension({ scriptWorkspaceDir: join(root, "scripts") }) }] },
		});
		({ session } = await createAgentSessionFromServices({ services, sessionManager, noTools: "builtin" }));
		await session.bindExtensions({ mode: "rpc" });
		const policy = toolPolicyForSession(sessionManager.getSessionId());
		expect(policy?.store.directory).toBe(configuredDirectory);
		await expect(access(join(configuredDirectory, "tool-settings.json"))).resolves.toBeUndefined();
		await expect(access(profile.defaultDirectory)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await toolPolicyForSession(sessionManager.getSessionId())?.close();
		session?.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
