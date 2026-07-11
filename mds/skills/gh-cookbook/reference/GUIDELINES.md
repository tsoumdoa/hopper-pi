# Recipe Authoring Guidelines

> **Human maintainers only** — not agent runtime guidance. Agents load recipes via [gh-cookbook SKILL.md](../SKILL.md).

Use this checklist when adding a new recipe to the cookbook.

## File Naming

- Path: `reference/recipe-{N}-{slug}.md`
- `{N}` = next sequential number (0, 1, 2, …)
- `{slug}` = short kebab-case outcome name (e.g., `extrude`, `pipe-sweep`)

## Template

```markdown
# Recipe {N} — {Outcome Name}

**What:** One-sentence description of what this recipe produces.

**Zone Map:** `[params] → [processing] → [output]` *(brief layout hint)*

## Components (only when configuration is not clear in the wiring diagram)

| Step | Component | Config | Notes |
|------|-----------|--------|-------|
| ... | **ComponentType** | required values / modes | gotchas or alternatives |

## Wiring

```
ASCII diagram showing left-to-right data flow with port labels.
```

## Output
What comes out and its data shape (single? list? tree?).

## Typical Next Steps
- Link to other recipes by number where this output naturally feeds.
- Mention common composition patterns.
```

## Rules

1. **Name it for the outcome**, not the tool. ("Subdivide Surface" not "Divide Domain² Recipe")
2. **Zone Map required** — one-line ASCII at top showing params → processing → output placement.
3. **Configuration detail** — use a compact component table only when required settings or alternatives are not clear in the wiring diagram.
4. **ASCII wiring diagram** — left-to-right flow, clear port labels.
5. **Output** — what comes out and what data shape it has (list? tree? single?).
6. **Typical next steps** — where this output usually feeds (link to other recipes by number).
7. **Keep it under 60 lines** per file. If longer, split into sub-sections (like 5a/5b).
8. **Add benchmark prompts** in [docs/gh-cookbook-benchmarks.md](../../../../docs/gh-cookbook-benchmarks.md) when a combination is used for QA.
9. **Register it in the Recipes table** in `SKILL.md` so it's discoverable (under the right category).
