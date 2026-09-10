import type { RuntimeStatus } from "../../../src/protocol/v2.js";

export const mockRuntimeStatus: RuntimeStatus = {
	protocolVersion: 2,
	revision: 42,
	observedAt: Date.now(),
	lifecycle: { state: "running", changedAt: Date.now(), reason: null },
	transport: { ready: true, lifecycleInstanceId: "mock-rhino-instance" },
	host: { state: "running", processId: 5124, nodePath: "/mock/node", nodeVersion: "22.19.0", handshake: "live", healthFailureCount: 0 },
	rhino: { activeDocument: true, documentName: "atrium-study.3dm" },
	grasshopper: { state: "ready", activeDocument: true, documentName: "atrium-grid.gh" },
	dispatcher: { depth: 0, capacity: 64, acceptingExternalWork: true },
	errors: { transport: null, host: null, rhino: null, grasshopper: null, dispatcher: null },
};
