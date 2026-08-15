import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { describe, test } from "vitest";
import type {
	ArtifactRecord,
	JsonValue,
	OperationResult,
	ProgressEvent,
} from "../../core/contracts.js";
import type {
	HopperOperation,
	OperationContext,
} from "../../core/operations.js";
import {
	createPiToolDefinition,
	operationResultToAgentToolResult,
} from "./operation-adapter.js";

type TestInput = { value: string };
type TestOutput = { echoed: string };

function result<T extends JsonValue>(
	overrides: Partial<OperationResult<T>> & Pick<OperationResult<T>, "outcome" | "message">,
): OperationResult<T> {
	return {
		data: null,
		warnings: [],
		artifacts: [],
		error: null,
		...overrides,
	};
}

function testOperation(
	execute: HopperOperation<TestInput, TestOutput>["execute"],
	possibleScopes: HopperOperation<TestInput, TestOutput>["possibleScopes"] = ["none"],
): HopperOperation<TestInput, TestOutput> {
	return {
		name: "test_echo",
		version: 1,
		description: "Echo a value",
		group: "gh-read",
		possibleScopes,
		inputSchema: Type.Object({ value: Type.String() }) as HopperOperation<TestInput, TestOutput>["inputSchema"],
		outputSchema: Type.Object({ echoed: Type.String() }) as HopperOperation<TestInput, TestOutput>["outputSchema"],
		classifyScope: () => possibleScopes[0] ?? "none",
		execute,
		summarizeInput: (input) => ({ value: input.value }),
	};
}

test("maps successful structured data into Pi content and details", () => {
	const operationResult = result<TestOutput>({
		outcome: "succeeded",
		message: "Echo completed",
		data: { echoed: "hello" },
	});

	const mapped = operationResultToAgentToolResult(operationResult);

	assert.deepEqual(mapped.details, { kind: "result", result: operationResult });
	assert.equal(mapped.content.length, 1);
	assert.match(mapped.content[0]?.type === "text" ? mapped.content[0].text : "", /Echo completed/);
	assert.match(mapped.content[0]?.type === "text" ? mapped.content[0].text : "", /"echoed": "hello"/);
});

test("keeps structured failures instead of reducing them to prose", () => {
	const operationResult = result<TestOutput>({
		outcome: "failed",
		message: "Echo failed",
		error: {
			code: "operation_failed",
			message: "Backend rejected the value",
			retryable: false,
		},
	});

	const mapped = operationResultToAgentToolResult(operationResult);

	assert.deepEqual(mapped.details, { kind: "result", result: operationResult });
	assert.match(mapped.content[0]?.type === "text" ? mapped.content[0].text : "", /operation_failed/);
	assert.match(mapped.content[0]?.type === "text" ? mapped.content[0].text : "", /Backend rejected the value/);
});

test("reports artifact metadata without reading artifact files", () => {
	const artifact: ArtifactRecord = {
		artifactId: "artifact_1",
		kind: "viewport_capture",
		path: "/safe/artifacts/view.png",
		mediaType: "image/png",
		byteLength: 2048,
		sha256: "abc123",
	};
	const mapped = operationResultToAgentToolResult(result<TestOutput>({
		outcome: "succeeded",
		message: "Captured view",
		data: { echoed: "done" },
		artifacts: [artifact],
	}));
	const text = mapped.content[0]?.type === "text" ? mapped.content[0].text : "";

	assert.match(text, /\/safe\/artifacts\/view\.png/);
	assert.match(text, /image\/png, 2048 bytes/);
	assert.match(text, /sha256 abc123/);
	assert.deepEqual(mapped.details.kind === "result" ? mapped.details.result.artifacts : [], [artifact]);
});

describe("createPiToolDefinition", () => {
	test("preserves operation metadata and executes with a caller-owned context", async () => {
		let receivedInput: TestInput | undefined;
		let receivedContext: OperationContext | undefined;
		let contextFactoryToolCallId: string | undefined;
		const operation = testOperation(async (input, context) => {
			receivedInput = input;
			receivedContext = context;
			return result<TestOutput>({
				outcome: "succeeded",
				message: "done",
				data: { echoed: input.value },
			});
		});
		const context = {} as OperationContext;
		const tool = createPiToolDefinition(operation, {
			label: "Test echo",
			createContext(args) {
				contextFactoryToolCallId = args.toolCallId;
				return context;
			},
		});

		const mapped = await tool.execute(
			"call_1",
			{ value: "hello" },
			undefined,
			undefined,
			{} as never,
		);

		assert.equal(tool.name, operation.name);
		assert.equal(tool.label, "Test echo");
		assert.equal(tool.description, operation.description);
		assert.equal(tool.parameters, operation.inputSchema);
		assert.equal(tool.executionMode, "parallel");
		assert.equal(contextFactoryToolCallId, "call_1");
		assert.deepEqual(receivedInput, { value: "hello" });
		assert.equal(receivedContext, context);
		assert.equal(mapped.details.kind, "result");
	});

	test("forwards structured progress through Pi updates", async () => {
		const progress: ProgressEvent = {
			phase: "apply",
			message: "Applying graph",
			completed: 2,
			total: 4,
		};
		const updates: unknown[] = [];
		const operation = testOperation(async (_input, context) => {
			context.reportProgress(progress);
			return result<TestOutput>({
				outcome: "succeeded",
				message: "done",
				data: { echoed: "hello" },
			});
		}, ["grasshopper"]);
		const tool = createPiToolDefinition(operation, {
			createContext(args) {
				return { reportProgress: args.reportProgress } as OperationContext;
			},
		});

		await tool.execute(
			"call_2",
			{ value: "hello" },
			undefined,
			(update) => updates.push(update),
			{} as never,
		);

		assert.equal(tool.executionMode, "sequential");
		assert.deepEqual(updates, [{
			content: [{ type: "text", text: "Applying graph (2/4)" }],
			details: { kind: "progress", progress },
		}]);
	});

	test("emits viewport image artifacts as Pi image content", async () => {
		const directory = await mkdtemp(join(tmpdir(), "hopper-pi-adapter-"));
		try {
			const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
			const imagePath = join(directory, "view.png");
			await writeFile(imagePath, imageBytes);
			const artifact: ArtifactRecord = {
				artifactId: "artifact_image",
				kind: "viewport_capture",
				path: imagePath,
				mediaType: "image/png",
				byteLength: imageBytes.byteLength,
				sha256: "abc123",
			};
			const operation = testOperation(async () => result<TestOutput>({
				outcome: "succeeded",
				message: "Captured view",
				data: { echoed: "done" },
				artifacts: [artifact],
			}));
			const tool = createPiToolDefinition(operation, {
				createContext: () => ({} as OperationContext),
			});

			const mapped = await tool.execute(
				"call_capture",
				{ value: "capture" },
				undefined,
				undefined,
				{} as never,
			);
			const image = mapped.content.find((content) => content.type === "image");
			assert.ok(image && image.type === "image");
			assert.equal(image.data, imageBytes.toString("base64"));
			assert.equal(image.mimeType, "image/png");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
