import type { OperationName, ValidationResult } from "./v2.js";

// Shared native transports repeat owner and document validation at the UI queue head.
export type TargetBinding =
 | Readonly<{ lifecycleInstanceId: string; kind: "rhino"; rhinoDocumentId: string }>
 | Readonly<{ lifecycleInstanceId: string; kind: "grasshopper"; grasshopperDocumentId: string; associatedRhinoDocumentId: string | null }>;
export type ExecutionOwner = Readonly<{
 taskId: string;
 turnId: string;
 binding: TargetBinding;
 attachmentGeneration: string;
}>;

function record(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
 return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identifier(value: unknown): value is string {
 return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && value.trim() === value;
}
export function validateTargetBinding(input: unknown): ValidationResult<TargetBinding> {
 if (!record(input) || !identifier(input.lifecycleInstanceId)) return { ok: false, errors: ["invalid binding lifecycle"] };
 if (input.kind === "rhino" && exact(input, ["kind", "lifecycleInstanceId", "rhinoDocumentId"]) && identifier(input.rhinoDocumentId)) {
  return { ok: true, value: Object.freeze({ kind: "rhino", lifecycleInstanceId: input.lifecycleInstanceId, rhinoDocumentId: input.rhinoDocumentId }) };
 }
 if (input.kind === "grasshopper" && exact(input, ["kind", "lifecycleInstanceId", "grasshopperDocumentId", "associatedRhinoDocumentId"])
  && identifier(input.grasshopperDocumentId) && (input.associatedRhinoDocumentId === null || identifier(input.associatedRhinoDocumentId))) {
  return { ok: true, value: Object.freeze({ kind: "grasshopper", lifecycleInstanceId: input.lifecycleInstanceId, grasshopperDocumentId: input.grasshopperDocumentId, associatedRhinoDocumentId: input.associatedRhinoDocumentId }) };
 }
 return { ok: false, errors: ["binding must name exactly one document kind and explicitly capture its association"] };
}
export function validateExecutionOwner(input: unknown): ValidationResult<ExecutionOwner> {
 if (!record(input) || !exact(input, ["taskId", "turnId", "binding", "attachmentGeneration"])
  || !identifier(input.taskId) || !identifier(input.turnId) || !identifier(input.attachmentGeneration)) return { ok: false, errors: ["invalid execution owner"] };
 const binding = validateTargetBinding(input.binding);
 if (!binding.ok) return binding;
 return { ok: true, value: Object.freeze({ taskId: input.taskId, turnId: input.turnId, binding: binding.value, attachmentGeneration: input.attachmentGeneration }) };
}

// Create/open uses host-managed action ownership and affected-document preconditions.
// Ordinary edits retain their captured document binding.
export type BindingRequirement = "lifecycle" | "rhino" | "grasshopper" | "associated-pair" | "either-document" | "document-action";
export type OperationPolicy = Readonly<{
 operationClass: "query" | "control" | "mutation";
 binding: BindingRequirement;
 dispatchJournal: "none" | "host-only" | "wire-mutation";
 recovery: "revalidate-read" | "retained-mutation-result" | "runtime-postcondition" | "cancelled-mutation-result" | "authenticated-attachment";
 // Native adapters validate captured active contexts; managed document actions also carry host-created dispatch receipts.
 sharedDispatch: "native-context-guarded";
}>;
function policy(operationClass: OperationPolicy["operationClass"], binding: BindingRequirement,
 dispatchJournal: OperationPolicy["dispatchJournal"], recovery: OperationPolicy["recovery"]): OperationPolicy {
 return Object.freeze({ operationClass, binding, dispatchJournal, recovery, sharedDispatch: "native-context-guarded" });
}
export const SHARED_OPERATION_POLICY = Object.freeze({
 listRhinoDocuments: policy("query", "lifecycle", "none", "revalidate-read"),
 getRhinoDocument: policy("query", "rhino", "none", "revalidate-read"),
 getRhinoDocumentSettings: policy("query", "rhino", "none", "revalidate-read"),
 listGrasshopperDocuments: policy("query", "lifecycle", "none", "revalidate-read"),
 getGrasshopperDocument: policy("query", "grasshopper", "none", "revalidate-read"),
 getGrasshopperDocumentSettings: policy("query", "associated-pair", "none", "revalidate-read"),
 browseDocumentFiles: policy("query", "lifecycle", "none", "revalidate-read"),
 getDocumentTransactionState: policy("query", "either-document", "none", "revalidate-read"),
 getRuntimeStatus: policy("query", "lifecycle", "none", "revalidate-read"),
 getOperationResult: policy("query", "lifecycle", "none", "revalidate-read"),
 listAllComponents: policy("query", "lifecycle", "none", "revalidate-read"),
 getCurrentCanvas: policy("query", "grasshopper", "none", "revalidate-read"),
 getCanvasErrors: policy("query", "grasshopper", "none", "revalidate-read"),
 getData: policy("query", "grasshopper", "none", "revalidate-read"),
 listScriptParams: policy("query", "grasshopper", "none", "revalidate-read"),
 getScriptCode: policy("query", "grasshopper", "none", "revalidate-read"),
 queryRhinoObjects: policy("query", "rhino", "none", "revalidate-read"),
 captureRhinoView: policy("query", "rhino", "none", "revalidate-read"),
 getParamRhinoGeometry: policy("query", "associated-pair", "none", "revalidate-read"),
 lifecycleHandshake: policy("control", "lifecycle", "host-only", "authenticated-attachment"),
 startGrasshopper: policy("control", "lifecycle", "host-only", "runtime-postcondition"),
 cancelOperation: policy("control", "lifecycle", "host-only", "cancelled-mutation-result"),
 manageRhinoDocument: policy("mutation", "document-action", "wire-mutation", "retained-mutation-result"),
 manageGrasshopperDocument: policy("mutation", "document-action", "wire-mutation", "retained-mutation-result"),
 applyGraph: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 runRhinoScript: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 controlRhinoView: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 addComponent: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 deleteComponent: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 connectWire: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 disconnectWire: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 moveComponent: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 renameComponent: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setComponentLocked: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setComponentHidden: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 addGroup: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 removeFromGroup: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 deleteGroup: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 changeGroupColor: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 renameGroup: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 changeGroupStyle: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createSlider: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 editSliderRange: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setSliderValue: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createPanel: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setPanelParams: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setPanelText: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createToggle: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setToggleValue: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createSwatch: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setSwatchColor: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createScribble: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setScribbleText: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createValueList: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setValueListSelected: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 createScriptNode: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 setScriptCode: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 syncScriptParams: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 addScriptInput: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 removeScriptInput: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 addScriptOutput: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 removeScriptOutput: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 editParamProps: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 beginAgentTransaction: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 commitAgentTransaction: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 cancelAgentTransaction: policy("mutation", "grasshopper", "wire-mutation", "retained-mutation-result"),
 beginRhinoAgentTransaction: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 commitRhinoAgentTransaction: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 cancelRhinoAgentTransaction: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 exportRhinoArtifact: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 importRhinoArtifact: policy("mutation", "rhino", "wire-mutation", "retained-mutation-result"),
 setParamRhinoGeometry: policy("mutation", "associated-pair", "wire-mutation", "retained-mutation-result"),
} satisfies Record<OperationName, OperationPolicy>);

/** Structural authority check only. Callers must still validate live identities,
 * association, generation, task state and process ownership at dispatch/execute. */
export function bindingSatisfiesRequirement(binding: TargetBinding, requirement: BindingRequirement): boolean {
 switch (requirement) {
  case "lifecycle": case "either-document": return true;
  case "rhino": return binding.kind === "rhino" || binding.associatedRhinoDocumentId !== null;
  case "grasshopper": return binding.kind === "grasshopper";
  case "associated-pair": return binding.kind === "grasshopper" && binding.associatedRhinoDocumentId !== null;
  case "document-action": return false;
 }
}

export type DocumentActionOwner = Readonly<{
 taskId:string;turnId:string;actionId:string;grantId:string;lifecycleInstanceId:string;attachmentGeneration:string;
}>;
export function validateDocumentActionOwner(input:unknown):ValidationResult<DocumentActionOwner> {
 const keys=['taskId','turnId','actionId','grantId','lifecycleInstanceId','attachmentGeneration'];
 if(!record(input) || !exact(input,keys) || !keys.every(key=>identifier(input[key]))) return {ok:false,errors:['invalid document action owner']};
 return {ok:true,value:Object.freeze({...input}) as DocumentActionOwner};
}
