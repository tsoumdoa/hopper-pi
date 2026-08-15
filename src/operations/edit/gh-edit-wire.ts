import { Type, type Static } from "@sinclair/typebox";
import type { JsonObject, JsonValue } from "../../core/contracts.js";
import { defineOperation } from "../../core/operations.js";
import { resolveInstanceGuid } from "../../services/guid-shortener.js";
import {
	ItemOperationDataSchema,
	commandAction,
	executePreparedItemMutation,
	preservePiSchemaJson,
	preparedItemMutation,
} from "./shared.js";

export const GhEditWireInputSchema = preservePiSchemaJson(Type.Object({
	items: Type.Array(Type.Object({
		action: Type.Union([Type.Literal("connect"), Type.Literal("disconnect")]),
		fromComponent: Type.String({ description: "Source component GUID" }),
		fromPort: Type.String({ description: "Source output port GUID" }),
		toComponent: Type.String({ description: "Target component GUID" }),
		toPort: Type.String({ description: "Target input port GUID" }),
	}), { minItems: 1 }),
}));

export type GhEditWireInput = Static<typeof GhEditWireInputSchema> & JsonValue;

async function prepareMutation(input: GhEditWireInput) {
	const descriptors = input.items.map((item) => ({
		action: item.action === "connect" ? "connectWire" : "disconnectWire",
	}));
	const actions = input.items.map((item) => commandAction(
		item.action === "connect" ? "connectWire" : "disconnectWire",
		{
			from: {
				componentId: resolveInstanceGuid(item.fromComponent),
				port: resolveInstanceGuid(item.fromPort),
			},
			to: {
				componentId: resolveInstanceGuid(item.toComponent),
				port: resolveInstanceGuid(item.toPort),
			},
		},
	));
	return preparedItemMutation(actions, descriptors);
}

export const ghEditWireOperation = defineOperation({
	name: "gh_edit_wire",
	version: 1,
	description: "Connect or disconnect Grasshopper wires.",
	group: "gh-edit",
	possibleScopes: ["grasshopper"],
	inputSchema: GhEditWireInputSchema,
	outputSchema: ItemOperationDataSchema,
	classifyScope: () => "grasshopper",
	prepareMutation: (input) => prepareMutation(input),
	execute: (input, context) => executePreparedItemMutation(prepareMutation, input, context),
	summarizeInput: (input): JsonObject => ({
		itemCount: input.items.length,
		items: input.items.map((item, index) => ({ index, ...item })),
	}),
});
