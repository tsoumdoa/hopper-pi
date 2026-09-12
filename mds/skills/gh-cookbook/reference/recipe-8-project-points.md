# Recipe 8: Project points

Project points onto target geometry along a specified direction.

```text
Points, target geometry, direction -> Project Point -> Projected points
```

For downward projection, use `{0,0,-1}`. Verify the selected component's supported geometry, direction behavior, and outputs. A point can miss or produce multiple intersections; inspect output counts and source correspondence rather than assuming one hit per point or a particular missing-value index.

Use Pull Point for a closest-point operation. If downstream geometry needs UV coordinates or normals, obtain them from the hit surface after projection.
