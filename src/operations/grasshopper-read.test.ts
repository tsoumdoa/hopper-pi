import { describe, expect, it, vi } from "vitest";
import type {
	ArtifactWriter,
	BackendClient,
	JsonObject,
	JsonValue,
	RequestId,
} from "../core/contracts.js";
import { OperationRegistry, type OperationContext } from "../core/operations.js";
import {
	ghGetCanvasErrorsOperation,
	ghGetCanvasOperation,
	ghListComponentsOperation,
} from "./grasshopper-read.js";

const EMPTY_CANVAS_XML = `<?xml version="1.0" encoding="utf-8"?>
<Archive name="Root"><items count="0" /></Archive>`;

function context(responses: Record<string, JsonValue>): OperationContext {
	const backend: BackendClient = {
		async query<T extends JsonValue>(request: JsonObject): Promise<T> {
			return responses[String(request.type)] as T;
		},
		async executeActions() {
			throw new Error("not used");
		},
	};
	return {
		signal: new AbortController().signal,
		requestId: "req_test" as RequestId,
		session: null,
		backend,
		artifacts: {} as ArtifactWriter,
		reportProgress: vi.fn(),
		now: () => new Date("2026-01-01T00:00:00.000Z"),
	};
}

describe("Grasshopper read operations", () => {
	it("classifies all three operations as read-only", () => {
		expect(ghGetCanvasOperation.classifyScope({})).toBe("none");
		expect(ghListComponentsOperation.classifyScope({ queries: ["line"] })).toBe("none");
		expect(ghGetCanvasErrorsOperation.classifyScope({})).toBe("none");
	});

	it("returns structured component search data", async () => {
		const registry = new OperationRegistry();
		registry.register(ghListComponentsOperation);
		const call = registry.resolve("gh_list_components", { queries: ["line"] });
		const result = await registry.execute(call, context({
			listAllComponents: {
				type: "listAllComponents.response",
				timestamp: 1,
				components: [{
					name: "Line",
					typeGuid: "line-guid",
					pluginName: "Grasshopper",
					assemblyName: "Grasshopper",
					category: "Curve",
					subcategory: "Primitive",
					description: "Creates a line.",
				}],
			},
		}));

		expect(result.outcome).toBe("succeeded");
		expect(result.data).toMatchObject({ total: 1, offset: 0, limit: 10 });
	});

	it("combines runtime errors with overlap data", async () => {
		const registry = new OperationRegistry();
		registry.register(ghGetCanvasErrorsOperation);
		const result = await registry.execute(
			registry.resolve("gh_get_canvas_errors", {}),
			context({
				getCanvasErrors: {
					type: "getCanvasErrors.response",
					timestamp: 1,
					docName: "Untitled",
					errors: [],
				},
				getCurrentCanvas: {
					type: "getCurrentCanvas.response",
					timestamp: 1,
					docName: "Untitled",
					xml: EMPTY_CANVAS_XML,
				},
			}),
		);

		expect(result.outcome).toBe("succeeded");
		expect(result.data).toMatchObject({ errors: [] });
	});
});
