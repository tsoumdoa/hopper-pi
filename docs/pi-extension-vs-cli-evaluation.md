# Pi extension vs CLI evaluation

Date: 2026-08-21

## Recommendation

Keep the Pi extension as the primary interactive modeling experience. Keep the `hopper` CLI as a second interface for automation, testing, and agents outside Pi.

The CLI is a useful product boundary, but it does not yet replace the experience supplied by the Pi extension. Removing the extension would also remove modeling guidance, repair tools, viewport tools, user interaction, and coordinated undo behavior. Those parts matter when the user wants to design in Grasshopper rather than run a prepared automation job.

If only one interface can remain, choose the Pi extension for a designer-facing product. Choose the CLI for agent-neutral infrastructure.

## Test case

The comparison uses this prompt:

> Create a parametric pavilion in Grasshopper using a rectangular base of 20 m by 12 m. Divide the surface into panels, apply an attractor point to vary panel height, and be creative.

The CLI run produced a folded canopy with:

- a 20 m by 12 m footprint;
- a 10 by 6 panel grid;
- attractor-controlled roof elevation;
- adjustable minimum height, maximum height, falloff, fold, and attractor position;
- perimeter supports and colored previews;
- 4 display components, 17 controls and annotations, 1 Python generator, 18 wires, and 3 groups;
- no Grasshopper runtime warnings.

The Grasshopper backend applied the graph in about 2.5 seconds. The resulting geometry was good. Most of the friction happened before and after that backend operation.

## What happened during the CLI run

The workflow required these steps:

1. Discover the installed `hopper` command and inspect its help and schemas.
2. Start Grasshopper and confirm that the `Hopper Code Backend` component was present.
3. Check backend status and query the installed component registry.
4. Write a Python generator and a separate graph description.
5. Assemble the graph JSON and submit it through `hopper gh call apply-graph`.
6. Investigate an opaque `Internal CLI error` from the first apply attempt.
7. Confirm that the canvas had not changed before retrying.
8. Run the same normalized operation through the internal operation core, which succeeded.
9. Use Mac application control to inspect the Grasshopper canvas and Rhino viewport.
10. Use the Grasshopper interface to attempt to save the definition.

The first apply failure is a CLI problem. It returned no useful diagnostic, even though the same request succeeded through the operation core. A general CLI caller would not have that fallback.

The local-network approval was caused by the Codex sandbox. A normal terminal would not require it, so it should not count against Hopper.

Starting Rhino and Grasshopper is common to both approaches. The Pi extension still needs the backend component and a live Rhino session.

## Experience comparison

| Area | Pi extension on `main` | CLI branch |
| --- | --- | --- |
| Starting a task | Registers Hopper tools in the conversation and supplies backend status UI | Caller must discover commands, schemas, connection state, and input rules |
| Modeling knowledge | Bundles Grasshopper modeling, layout, script, data-tree, and cookbook guidance | Caller owns planning and Grasshopper knowledge |
| Graph submission | Agent sends a structured tool argument | Agent or human must serialize JSON through a file, stdin, or shell argument |
| New graph creation | Uses the same atomic `gh_apply_graph` backend operation | Uses the same atomic `gh_apply_graph` backend operation |
| Iteration | Can move components, change widgets, edit ports, patch scripts, rewire, regroup, and inspect errors | Supports whole-graph creation but does not expose the fine-grained edit tools |
| Definition readability | Bundled plans favor native Grasshopper components and visible data flow | External agents are likely to collapse logic into one script component |
| Runtime QA | Has canvas errors, overlap checks, viewport control, and optional viewport capture | Apply returns runtime and overlap data, but broader visual QA needs another tool or the GUI |
| User choices | Can ask free-text questions or present informed options inside the session | Caller owns all interaction |
| Undo | Coordinates one Grasshopper and one Rhino undo step per agent turn | `gh_apply_graph` has per-call rollback and undo; `rh_run_script` is non-atomic |
| Failure recovery | Fine-grained tools allow a small repair | Limited operation set often makes rebuilding or leaving the CLI necessary |
| Portability | Tied to Pi | Works with shell scripts, CI, Codex, and other agents |
| Contract clarity | Tool contracts live inside the extension | JSON responses, schemas, target identity, and exit codes are explicit |
| Maintenance size | Larger integration with session hooks, UI, skills, and more tools | Smaller process with a narrow public contract |

## The definition-quality issue

The interface affects what the agent builds.

The Pi version contains a detailed plan for this exact pavilion prompt in [`prompt-examples/pavilion-attractor-plan.md`](../prompt-examples/pavilion-attractor-plan.md). That plan uses native Grasshopper components for subdivision, distances, remapping, facets, color, pipes, and previews. A Grasshopper user can open the file and understand or alter the logic.

The CLI run used one Python component for the geometry. This was a rational response to the interface. A script is shorter to serialize, has fewer component types and ports to resolve, and reduces the chance of a large JSON request failing. The geometry remains parametric, but most of the design logic becomes opaque on the canvas.

`gh_apply_graph` can create a native component graph through the CLI. The problem is not a hard CLI limitation. The missing piece is the packaged modeling experience that tells an external agent how to build a readable Grasshopper definition and makes repair cheap when one port or component is wrong.

For computational designers, canvas readability is part of the output. A correct Rhino preview is not enough.

## Strengths of the Pi extension

The Pi extension is better suited to conversational modeling because it includes:

- automatic tool registration;
- [`gh-modeling-expert`](../mds/skills/gh-modeling-expert/SKILL.md) and the Grasshopper cookbook;
- prompt routing and progressive tool loading;
- fine-grained Grasshopper editing tools;
- viewport control and optional screenshot capture;
- user-choice tools;
- a transaction around the whole agent turn;
- backend status and schema UI.

These features reduce agent setup and make a failed or incomplete build repairable.

The cost is coupling. The package depends on Pi APIs, session hooks, model behavior, UI conventions, and Pi packaging. Other agents cannot use the same experience directly.

## Strengths of the CLI

The CLI is better suited to automation and reuse because it has:

- one JSON object in and one JSON object out;
- offline operation and schema discovery;
- explicit exit codes;
- bounded one-shot processes;
- target identity in backend responses;
- conservative reporting when a mutation result is unknown;
- no required agent SDK;
- straightforward use from scripts, tests, and CI.

This is the right interface for reproducible jobs and integration with multiple agents. It is also a good diagnostic and development tool for the shared operation core.

## Recommended architecture

Keep one operation core and expose it through two adapters:

```text
Grasshopper plugin
        ^
typed operation core
    /           \
Pi extension   hopper CLI
interactive    automation
```

The operation core should own:

- request and response schemas;
- target identity;
- component resolution;
- graph validation and normalization;
- backend transport;
- mutation outcome rules;
- parsers and overlap checks.

The Pi adapter should own conversation-specific behavior such as tool registration, skills, prompts, user choices, viewport consent, and per-turn transactions.

The CLI adapter should own argument parsing, input loading, stdout discipline, exit codes, and process cancellation.

This keeps protocol and modeling logic shared without forcing every caller to depend on Pi.

## Minimum work before the CLI can replace Pi

The CLI would need at least the following additions before it offers a comparable modeling workflow:

1. Expose `gh_get_canvas_errors` as a public command.
2. Add surgical component, wire, group, widget, parameter, and script editing operations.
3. Add Rhino viewport control and optional viewport capture.
4. Add a supported way to save the connected Grasshopper document.
5. Ship the Grasshopper modeling skill as an agent-neutral package.
6. Preserve a way to group several calls into one user-visible undo step.
7. Replace opaque internal errors with a safe diagnostic identifier and useful stderr details.
8. Add live smoke tests for blank canvases, large graph inputs, post-apply validation, saving, and recovery after a failed mutation.

The separately installable skill is important. Adding commands without guidance will still bias external agents toward monolithic script components.

## Suggested benchmark

Run the same prompt set through Pi and the CLI using fresh Grasshopper documents. Include simple native graphs, larger panel systems, existing-canvas repairs, script editing, Rhino baking, and viewport-dependent tasks.

Record:

- time to first valid geometry;
- number of backend mutations;
- number of user interventions;
- runtime errors after the first build;
- successful recovery rate;
- whether one Undo restores the requested change;
- number of native components versus script components;
- canvas overlaps;
- final definition readability, scored by a Grasshopper user;
- total model tokens and tool payload bytes.

The pavilion prompt should remain in this set. It exposed the difference between producing good geometry and producing a good Grasshopper definition.

## Branch-state note

At the time of this evaluation, [`PLAN.md`](../PLAN.md) proposes a CLI-only package and full removal of Pi. The current [`package.json`](../package.json) still includes the Pi manifest, Pi scripts, and Pi dependencies. The branch is therefore between the two product shapes.

That makes this a useful point to choose the long-term boundary. The recommendation from this test is to finish the shared operation core and CLI, but keep a thin Pi adapter and the modeling skills as the interactive product.
