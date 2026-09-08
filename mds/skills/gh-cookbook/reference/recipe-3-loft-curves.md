# Recipe 3: Loft curves

Create a loft through two or more ordered profiles.

```text
Ordered profile curves -> Loft -> Brep
```

Align curve direction and closed-profile seams to avoid twisting. Flatten only when separate branches belong to one loft. For independent lofts, keep one complete ordered profile set per branch; grafting individual curves does not create such sets.

Closed profiles do not guarantee a closed solid. Cap planar openings when a solid is requested and verify closure. The output contains the loft result for each profile set.
