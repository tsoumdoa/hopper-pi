---
name: gh-agent-loop
description: "Subagent-based Grasshopper development loop. Orchestrates 3 phases (architect, coder, validator) as independent subagent tasks with state-file handoff. Use when building or modifying GH definitions from client requests."
---

# GH Agent Loop — Subagent Build Pipeline

> **Pattern:** Use the `gh_loop` tool to delegate Grasshopper build work to a 3-phase subagent pipeline. State flows between phases via a state file on disk.
> **When to use:** Building new GH definitions, major modifications to existing definitions, or any request that requires multiple components wired together.

---

## How to Use

When a client asks you to build or modify something on the Grasshopper canvas, call the **`gh_loop`** tool with their request:

```
gh_loop(request: "the client's exact request text")
```

The tool handles everything:
1. **Architect phase** — analyzes the request, designs components, creates standard GH components on canvas, wires them, plans any C# scripts needed
2. **Coder phase** (skipped if no scripts) — creates C# script components, declares I/O, writes code, compiles, wires into graph
3. **Validator phase** — inspects live canvas vs spec, auto-fixes issues, produces PASS/FAIL verdict

After `gh_loop` completes:
- If **✅ PASS** → present the result to the client with a summary of what was built
- If **⚠️ PASS WITH NOTES** → present result + mention any warnings/warnings
- If **❌ FAIL** → inform the client what went wrong and what manual intervention may be needed

## What Happens Under the Hood

```
Client Request
     │
     ▼
┌─────────────┐    ┌──────────────────┐
│ ORCHESTRATOR │───▶│  architect       │
│ (this session)│    │  (subprocess)    │
└─────────────┘    │  Spec + Design   │
                   │  + Build + Wire  │
                   └──────┬───────────┘
                          │ state file (disk)
                          ▼
                   ┌──────────────────┐
                   │  coder           │  ← skipped if no scripts
                   │  (subprocess)    │
                   │  C# scripts only │
                   └──────┬───────────┘
                          │ state file updated
                          ▼
                   ┌──────────────────┐
                   │  validator       │
                   │  (subprocess)    │
                   │  Verify + Fix    │
                   └──────┬───────────┘
                          │ verdict
                          ▼
                   ✅ PASS / ❌ FAIL
```

Each phase runs as its own `pi` subprocess with:
- An isolated context window (fresh LLM session)
- A focused system prompt (only that phase's instructions)
- Access to the shared state file on disk
- Access to the GH tools it needs

## Interaction Points

| Event | Action |
|-------|--------|
| Before calling `gh_loop` | Make sure you understand the client's request. Clarify ambiguities first. |
| After `gh_loop` returns PASS | Summarize what was built for the client in plain language. |
| After `gh_loop` returns FAIL | Explain what failed and suggest next steps (simpler request, manual fix, etc.). |
| Client wants changes | Call `gh_loop` again with the modified request. The architect will inspect the existing canvas and plan modifications. |

## Conventions Reference

All three phases share a common set of GH development conventions (script policy, canvas layout rules, visibility patterns, C# boilerplate requirements). These are defined in `.pi/extensions/gh-subagents/conventions.md` and injected into every subagent prompt automatically.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Architect fails | Unclear request | Rephrase request with more detail before retrying |
| Coder compilation errors | Bad I/O signatures | Validator will catch this; retry loop handles it |
| Validator keeps failing | Fundamental design issue | May need manual intervention or simpler request |
| "Agent not found" | Extension not loaded | Ensure `.pi/extensions/gh-subagents/` is in place |
