# Recipe 5: Pipe and sweep

Create circular tubes or sweep a custom section along a rail.

```text
Rail curves, radius -> Pipe -> Breps
Rail, sections -----> Sweep1 -> Surface/Brep
```

For pipes, set a positive radius and choose the cap mode explicitly when closed ends are required. Closure depends on the rail and caps.

For sweeps, position and orient each section relative to its rail. Keep separate rail/section sets in the intended branches. Check the resulting geometry before treating it as solid.

After [edge extraction](./recipe-2-extract-edges.md), remove coincident rails if each shared edge should produce only one pipe.
