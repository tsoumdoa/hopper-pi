# Recipe 7: Populate surface points

Create a UV grid or a reproducible random distribution.

```text
Surface, U divisions, V divisions -> Divide Surface -> Points, Normals, UV
Surface, count, seed -------------> Populate Geometry -> Points
```

Division counts describe intervals, not point counts. For an open untrimmed rectangular surface, a grid including both ends has `(U + 1) × (V + 1)` samples. Verify counts, seams, and trimmed boundaries for the actual surface. Equal UV steps need not be equal physical distances.

Grid outputs have matching points and UV coordinates; inspect their branch structure. Random output contains points only. Use a fixed seed and Surface Closest Point when UV coordinates are needed for those points.
