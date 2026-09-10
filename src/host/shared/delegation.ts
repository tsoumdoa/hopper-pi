import { parseImages, type ImageAttachment } from "../protocol.js";
import { Type } from "@earendil-works/pi-ai";

const bindingId = () => Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" });
/** Match the native binding validator so agents can submit a valid target on the first call. */
export const delegationBindingSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("rhino"),
		lifecycleInstanceId: bindingId(),
		rhinoDocumentId: bindingId(),
	}, { additionalProperties: false }),
	Type.Object({
		kind: Type.Literal("grasshopper"),
		lifecycleInstanceId: bindingId(),
		grasshopperDocumentId: bindingId(),
		associatedRhinoDocumentId: Type.Union([bindingId(), Type.Null()]),
	}, { additionalProperties: false }),
], { description: "Copy one exact documents entry from listRhinoTargets, including kind and lifecycleInstanceId. Grasshopper requires associatedRhinoDocumentId, explicitly null when unassociated." });

/** Child inputs are copies of explicitly selected parent images, never sibling history. */
export function selectDelegationImages(
	attachments: readonly unknown[],
	indices?: readonly number[],
): ImageAttachment[] {
	const images =
		parseImages(
			attachments.filter(
				(value) =>
					value &&
					typeof value === "object" &&
					(value as { type?: unknown }).type === "image",
			),
		) ?? [];
	const selection = indices ?? images.map((_image, index) => index);
	if (
		!Array.isArray(selection) ||
		selection.some(
			(index) =>
				!Number.isInteger(index) || index < 0 || index >= images.length,
		) ||
		new Set(selection).size !== selection.length
	)
		throw new Error(
			"Attachment indices must be unique, zero-based indices of supplied parent images",
		);
	return selection.map((index) => ({ ...images[index]! }));
}

import { createHash } from "node:crypto";
import type { TaskJournal } from "./journal.js";
import { MAX_IMAGES } from "../protocol.js";

/** Give the coordinator actual image blocks; JSON text alone is not visual evidence. */
export function collectDelegationResults(
	snapshot: ReturnType<TaskJournal["snapshot"]>,
	rootTaskId: string,
): {
	content: ({ type: "text"; text: string } | ImageAttachment)[];
	details: { imageCount: number; omittedImages: number };
} {
	const children = snapshot.tasks.filter(
			(task) => task.parent_task_id === rootTaskId,
		),
		ids = new Set(children.map((child) => child.id));
	const events = snapshot.events.filter((event) => ids.has(event.task_id)),
		messages = new Map<
			string,
			{ taskId: string; turnId: string; messages: any[] }
		>();
	const parse = (value: unknown): any => {
		try {
			return JSON.parse(String(value));
		} catch {
			return value;
		}
	};
	for (const event of events) {
		const payload = parse(event.payload);
		if (payload?.type === "messages" && Array.isArray(payload.messages))
			messages.set(`${event.task_id}:${payload.turnId}`, {
				taskId: String(event.task_id),
				turnId: String(payload.turnId),
				messages: payload.messages,
			});
	}
	const images: {
			image: ImageAttachment;
			taskId: string;
			turnId: string;
			toolCallId: string;
		}[] = [],
		seen = new Set<string>();
	let omittedImages = 0;
	for (const turn of messages.values())
		for (const message of turn.messages) {
			if (message.role !== "toolResult" || !Array.isArray(message.content))
				continue;
			for (const part of message.content)
				if (part?.type === "image") {
					let image: ImageAttachment;
					try {
						image = parseImages([part])![0]!;
					} catch {
						omittedImages++;
						continue;
					}
					const digest = createHash("sha256")
						.update(image.mimeType)
						.update(image.data)
						.digest("hex");
					if (seen.has(digest)) continue;
					seen.add(digest);
					if (images.length >= MAX_IMAGES) {
						omittedImages++;
						continue;
					}
					images.push({
						image,
						taskId: turn.taskId,
						turnId: turn.turnId,
						toolCallId: String(message.toolCallId ?? ""),
					});
				}
		}
	const sanitize = (value: any): any => {
		if (Array.isArray(value)) return value.map(sanitize);
		if (!value || typeof value !== "object") return value;
		if (value.type === "image" && typeof value.data === "string")
			return {
				type: "image_reference",
				mimeType: value.mimeType,
				sha256: createHash("sha256")
					.update(String(value.mimeType))
					.update(value.data)
					.digest("hex"),
			};
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, sanitize(item)]),
		);
	};
	const summary = {
		children: children.map((child) => ({
			...child,
			payload: sanitize(parse(child.payload)),
		})),
		events: events.map((event) => ({
			...event,
			payload: sanitize(parse(event.payload)),
		})),
		artifacts: snapshot.records
			.filter((record) => record.kind === "artifact" && ids.has(record.task_id))
			.map((record) => ({
				...record,
				payload: sanitize(parse(record.payload)),
			})),
		includedCaptureImages: images.length,
		omittedCaptureImages: omittedImages,
	};
	const content: ({ type: "text"; text: string } | ImageAttachment)[] = [
		{ type: "text", text: JSON.stringify(summary) },
	];
	for (const capture of images) {
		const turn = snapshot.turns.find((turn) => turn.id === capture.turnId),
			owner = turn ? parse(turn.owner) : null;
		content.push(
			{
				type: "text",
				text: `Capture from child task ${capture.taskId}, turn ${capture.turnId}, tool call ${capture.toolCallId}, target ${JSON.stringify(owner?.binding ?? null)}.`,
			},
			capture.image,
		);
	}
	return { content, details: { imageCount: images.length, omittedImages } };
}
