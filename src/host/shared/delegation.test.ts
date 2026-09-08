import { expect, it } from "vitest";
import {
	collectDelegationResults,
	selectDelegationImages,
} from "./delegation.js";
import { TaskJournal } from "./journal.js";
const image = { type: "image", mimeType: "image/png", data: "aGk=" };
it("copies all supplied images by default without inheriting other source objects", () => {
	const result = selectDelegationImages([image, { artifactId: "artifact" }]);
	expect(result).toEqual([image]);
	expect(result[0]).not.toBe(image);
});
it("allows an explicit empty or reordered selection and refuses expanded authority", () => {
	const images = [image, { ...image, data: "Ynll" }];
	expect(selectDelegationImages(images, [])).toEqual([]);
	expect(
		selectDelegationImages(images, [1, 0]).map((image) => image.data),
	).toEqual(["Ynll", "aGk="]);
	for (const indices of [[2], [-1], [0, 0], [0.5]])
		expect(() => selectDelegationImages(images, indices)).toThrow("indices");
});

it("returns bounded deduplicated capture image blocks with attributed text and measurements", () => {
	const journal = new TaskJournal(":memory:");
	journal.registerSession("conversation", "main");
	const binding = {
		kind: "rhino" as const,
		lifecycleInstanceId: "life",
		rhinoDocumentId: "doc",
	};
	const root = journal.accept({
		requestId: "root",
		conversationId: "conversation",
		sessionId: "main",
		kind: "prompt",
		text: "Compare",
		bindings: [binding],
		attachments: [],
	});
	journal.start(root.taskId, root.turnId);
	const child = journal.delegate({
		requestId: "child",
		conversationId: "conversation",
		sessionId: "worker",
		parentTaskId: root.taskId,
		dependencies: [],
		kind: "prompt",
		text: "Measure",
		bindings: [binding],
		attachments: [],
	});
	journal.start(child.taskId, child.turnId, {
		taskId: child.taskId,
		turnId: child.turnId,
		binding,
		attachmentGeneration: "generation",
	});
	const capture = (data: string) => ({
		type: "image",
		mimeType: "image/png",
		data: Buffer.from(data).toString("base64"),
	});
	journal.publish(child.taskId, {
		type: "messages",
		turnId: child.turnId,
		messages: [
			{
				role: "toolResult",
				toolCallId: "capture",
				content: [
					{ type: "text", text: "Measured area: 42" },
					capture("one"),
					capture("one"),
					capture("two"),
					capture("three"),
					capture("four"),
					capture("five"),
				],
			},
		],
	});
	const result = collectDelegationResults(journal.snapshot(), root.taskId);
	expect(result.details).toEqual({ imageCount: 4, omittedImages: 1 });
	expect(result.content.filter((part) => part.type === "image")).toHaveLength(
		4,
	);
	const text = result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ");
	expect(text).toContain("Measured area: 42");
	expect(text).toContain(child.taskId);
	expect(text).toContain("doc");
	expect(text).not.toContain(capture("one").data);
	journal.close();
});
