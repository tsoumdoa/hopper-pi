import { ToolPolicyStore } from "../../services/tool-policy-store.js";
import { HOPPER_POLICY_INVENTORY } from "../../tools/policy-inventory.js";
import { reconcilePolicySession, resolveToolPolicy } from "../../services/tool-policy.js";
import { ToolPolicyDenied } from "../../services/tool-policy-context.js";

export async function admitDocumentTool(kind: "rhino" | "grasshopper", directory?: string): Promise<void> {
 const store = new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory });
 try {
  await store.withSnapshot(policy => {
   const tool = HOPPER_POLICY_INVENTORY.find(tool => tool.name === (kind === "rhino" ? "rh_document" : "gh_document"))!;
   const runtime = { backend: true, images: false, ui: true, credentials: {} };
   const session = reconcilePolicySession(HOPPER_POLICY_INVENTORY, policy, runtime, false);
   const status = resolveToolPolicy(tool, policy, runtime, session, true);
   if (!status.callable) throw new ToolPolicyDenied(status.status);
  });
 } finally { await store.close(); }
}
