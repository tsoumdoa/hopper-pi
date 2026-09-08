# Recipe authoring

Use when adding or editing a cookbook recipe. Runtime discovery starts at [the cookbook index](../SKILL.md).

Name files `recipe-{N}-{outcome-slug}.md`, using the next available number. Include the result, a compact wiring diagram, required settings, and output shape. Add a component table only when the diagram cannot explain configuration. Verify component names, ports, and defaults; distinguish conceptual labels from exact selectors.

````markdown
# Recipe N: Outcome

One sentence describing the result.

## Wiring

```text
[Input] -> [Operation] -> [Output]
```

Required settings or data-tree handling.

## Output

Geometry type, list/tree structure, and limits that affect the result.
````

Link related recipes when they help compose the requested result. Omit generic next-step lists and repeated layout rules. Register the recipe in [SKILL.md](../SKILL.md); update [benchmarks](../../../../docs/gh-cookbook-benchmarks.md) when expected behavior changes.
