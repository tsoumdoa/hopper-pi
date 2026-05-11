---
description: Full 7-step Grasshopper canvas build pipeline — intent → planner → graph-architect → canvas-designer → script-writer → canvas-organizer → validator
---
Use the **subagent** tool with the **chain** parameter to execute the full Grasshopper canvas build pipeline:

1. First, use the **"intent"** agent to analyze the request and inspect the current canvas: "$@"
2. Then, use the **"planner"** agent to break it into milestones (use `{previous}` placeholder for intent output)
3. Then, use the **"graph-architect"** agent to design exact GH components + data trees + wire plan + create standard components + wire them (use `{previous}` placeholder)
4. Then, use the **"canvas-designer"** agent to define placement coordinates + **reposition standard components** + grouping + auxiliary elements (use `{previous}` placeholder)
5. Then, use the **"script-writer"** agent to create C# script components with gh_edit_script + connect deferred wires (use `{previous}` placeholder)
6. Then, use the **"canvas-organizer"** agent to create groups, name them descriptively, add scribble annotations + label panels for clarity (use `{previous}` placeholder)
7. Finally, use the **"validator"** agent to check canvas errors + verify architecture/design/organization compliance + patch issues (use `{previous}` placeholder)

## Validator Retry Loop
After step 7 completes, check the validator's final verdict:
- If **✅ PASS** or **⚠️ PASS WITH NOTES** — pipeline complete. Return the validator's full report.
- If **❌ FAIL** — identify which agent(s) the validator says need to re-run. Re-run only the failed agent(s) (passing the validator's issue report as context), then re-run the validator again. **Maximum 2 retry loops.** After 2 retries, return the latest validator report with ❌ FAIL and note that manual intervention is needed.

> **Context budget:** Each agent should output only its own section — do NOT echo back previous agents' full output. The `{previous}` mechanism passes context automatically. If upstream output is very long (>3000 chars), summarize only the parts relevant to YOUR work.

Execute as a chain. Pass each step's output to the next via `{previous}`.
