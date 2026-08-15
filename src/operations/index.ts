import type { JsonValue } from "../core/contracts.js";
import { OperationRegistry, type HopperOperation } from "../core/operations.js";
import { ghApplyGraphOperation } from "./apply-graph.js";
import {
	ghCreateWidgetOperation,
	ghEditComponentsOperation,
	ghEditGroupOperation,
	ghEditWireOperation,
	ghMutateWidgetOperation,
} from "./edit/index.js";
import {
	ghGetCanvasErrorsOperation,
	ghGetCanvasOperation,
	ghListComponentsOperation,
} from "./grasshopper-read.js";
import { ghEditParamOperation, ghParamRhinoOperation } from "./hybrid/index.js";
import {
	rhCaptureViewOperation,
	rhQueryObjectsOperation,
	rhRunScriptOperation,
	rhViewControlOperation,
} from "./rhino/index.js";
import { ghEditScriptOperation } from "./script/edit-script.js";

/** The runtime source of truth for all agent-facing Hopper operations. */
export const HOPPER_OPERATIONS = [
	ghApplyGraphOperation,
	ghCreateWidgetOperation,
	ghEditComponentsOperation,
	ghEditGroupOperation,
	ghEditParamOperation,
	ghEditScriptOperation,
	ghEditWireOperation,
	ghGetCanvasOperation,
	ghGetCanvasErrorsOperation,
	ghListComponentsOperation,
	ghMutateWidgetOperation,
	ghParamRhinoOperation,
	rhCaptureViewOperation,
	rhQueryObjectsOperation,
	rhRunScriptOperation,
	rhViewControlOperation,
] as const;

export function createOperationRegistry(): OperationRegistry {
	const registry = new OperationRegistry();
	for (const operation of HOPPER_OPERATIONS) {
		registry.register(
			operation as unknown as HopperOperation<JsonValue, JsonValue>,
		);
	}
	return registry;
}

