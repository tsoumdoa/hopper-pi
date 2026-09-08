import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindingSatisfiesRequirement, SHARED_OPERATION_POLICY, validateExecutionOwner, validateTargetBinding } from "./shared-execution.js";
import { classifyOperation, CONTROL_OPERATIONS, MUTATION_OPERATIONS, QUERY_OPERATIONS } from "./v2.js";

const rhino = { lifecycleInstanceId: "life-1", kind: "rhino", rhinoDocumentId: "rhino:1" };
const grasshopper = { lifecycleInstanceId: "life-1", kind: "grasshopper", grasshopperDocumentId: "gh:1", associatedRhinoDocumentId: null };

describe("shared execution contracts", () => {
 it("copies and freezes the captured identities", () => {
  const input = { taskId: "task-1", turnId: "turn-1", binding: { ...rhino }, attachmentGeneration: "generation-1" };
  const parsed = validateExecutionOwner(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("invalid fixture");
  input.binding.rhinoDocumentId = "rhino:2";
  expect(parsed.value.binding).toEqual(rhino);
  expect(Object.isFrozen(parsed.value)).toBe(true);
  expect(Object.isFrozen(parsed.value.binding)).toBe(true);
 });
 it.each([
  null, [], {}, { ...rhino, rhinoDocumentId: "rhino:1\n" }, { ...rhino, lifecycleInstanceId: "" }, { ...rhino, rhinoDocumentId: " " },
  { ...rhino, grasshopperDocumentId: "gh:1" },
  { ...grasshopper, associatedRhinoDocumentId: undefined },
  { ...grasshopper, associatedRhinoDocumentId: "" },
  { ...grasshopper, kind: "other" },
 ])("rejects ambiguous or malformed bindings %j", input => {
  expect(validateTargetBinding(input).ok).toBe(false);
 });
 it("requires every owner identity and rejects routing overrides", () => {
  const owner = { taskId: "task", turnId: "turn", binding: rhino, attachmentGeneration: "generation" };
  for (const key of Object.keys(owner)) {
   const missing: Record<string, unknown> = { ...owner };
   delete missing[key];
   expect(validateExecutionOwner(missing).ok).toBe(false);
  }
  expect(validateExecutionOwner({ ...owner, lifecycleInstanceId: "other" }).ok).toBe(false);
 });
 it("does not authorize a canvas from a Rhino selection or a pair from an unassociated canvas", () => {
  const r = validateTargetBinding(rhino);
  const g = validateTargetBinding(grasshopper);
  const pair = validateTargetBinding({ ...grasshopper, associatedRhinoDocumentId: "rhino:1" });
  if (!r.ok || !g.ok || !pair.ok) throw new Error("invalid fixture");
  expect(bindingSatisfiesRequirement(r.value, "grasshopper")).toBe(false);
  expect(bindingSatisfiesRequirement(g.value, "associated-pair")).toBe(false);
  expect(bindingSatisfiesRequirement(g.value, "rhino")).toBe(false);
  expect(bindingSatisfiesRequirement(pair.value, "associated-pair")).toBe(true);
  expect(bindingSatisfiesRequirement(pair.value, "rhino")).toBe(true);
  expect(bindingSatisfiesRequirement(pair.value, "document-action")).toBe(false);
 });
 it("classifies every operation explicitly and agrees with the C# policy", () => {
  const names = [...QUERY_OPERATIONS, ...CONTROL_OPERATIONS, ...MUTATION_OPERATIONS];
  expect(Object.keys(SHARED_OPERATION_POLICY).sort()).toEqual(names.sort());
  const csharp = readFileSync(new URL("../../dotnet/Hopper.Core/SharedExecutionContract.cs", import.meta.url), "utf8");
  const entries = [...csharp.matchAll(/RpcOperation\.(\w+) => new\("([^"]+)", "([^"]+)", "([^"]+)"\)/g)];
  expect(entries.map(match => match[1]).sort()).toEqual(names.sort());
  for (const name of names) {
   const policy = SHARED_OPERATION_POLICY[name];
   expect(policy.operationClass).toBe(classifyOperation(name));
   expect(policy.sharedDispatch).toBe("disabled-pending-native-audit");
   expect(policy.dispatchJournal).toBe(policy.operationClass === "mutation" ? "wire-mutation" : policy.operationClass === "control" ? "host-only" : "none");
   const match = entries.find(entry => entry[1] === name)!;
   expect(match.slice(2)).toEqual([policy.binding, policy.dispatchJournal, policy.recovery]);
  }
 });
 it("reconciles side-effecting controls by their postconditions", () => {
  expect(SHARED_OPERATION_POLICY.startGrasshopper.recovery).toBe("runtime-postcondition");
  expect(SHARED_OPERATION_POLICY.cancelOperation.recovery).toBe("cancelled-mutation-result");
  expect(SHARED_OPERATION_POLICY.lifecycleHandshake.recovery).toBe("authenticated-attachment");
 });
});
