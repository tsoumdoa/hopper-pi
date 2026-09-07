# Recipe 0: Rectangle surface

Create an adjustable planar rectangular surface.

```text
Plane, default XY ----------------------> Plane Surface plane
Width slider  -> Domain [0, width] ------> Plane Surface X extent
Height slider -> Domain [0, height] -----> Plane Surface Y extent
```

Use explicit domains when the rectangle's origin or extent matters. A Rectangle curve followed by Boundary Surfaces is another option.

The output is one planar surface. Feed it into [subdivision](./recipe-1-subdivide-surface.md), [point sampling](./recipe-7-populate-points.md), or [extrusion](./recipe-4-extrude.md).
