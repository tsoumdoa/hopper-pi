# Recipe 4: Extrude

Extrude geometry along a vector whose length sets the distance.

```text
Unit Z -------> Amplitude vector
Distance -----> Amplitude length
Geometry -----> Extrude base
Amplitude ----> Extrude direction
```

For another direction, replace Unit Z with the intended vector. Preserve branches when matching separate objects to different distances.

The output is extruded geometry. Curve extrusion generally leaves openings; cap planar boundaries when a solid is required and verify closure. Use surface inputs when the intended result includes the base region.
