---
description: Fast 5-step Grasshopper canvas build — skip intent/planner, go straight to architect → designer → writer → organizer → validator
---
Use the **subagent** tool with the **chain** parameter to execute a fast Grasshopper canvas build:

1. Use the **"graph-architect"** agent to design GH components + data trees + wire plan + create standard components + wire them for: "$@"
   > Note: Since planner is skipped, graph-architect will receive the raw request. It has built-in fallback guidance for this.
2. Use the **"canvas-designer"** agent to define placement coordinates + **reposition standard components** + grouping + auxiliary elements (use `{previous}` placeholder)
3. Use the **"script-writer"** agent to create C# script components via gh_edit_script + connect deferred wires (use `{previous}` placeholder)
4. Use the **"canvas-organizer"** agent to create groups, name groups, add scribbles/labels/annotations, and create sliders/toggles/swatches/value-lists per the design spec (use `{previous}` placeholder)
5. Use the **"validator"** agent to check canvas errors + verify architecture/design/organization compliance + patch issues (use `{previous}` placeholder)

## Validator Retry Loop
After step 5 completes, check the validator's final verdict:
- If **✅ PASS** or **⚠️ PASS WITH NOTES** — pipeline complete. Return the validator's full report.
- If **❌ FAIL** — identify which agent(s) the validator says need to re-run. Re-run only the failed agent(s) (passing the validator's issue report as context), then re-run the validator again. **Maximum 2 retry loops.** After 2 retries, return the latest validator report with ❌ FAIL and note that manual intervention is needed.

Execute as a chain. Skip intent + planner since requirements are already clear.
