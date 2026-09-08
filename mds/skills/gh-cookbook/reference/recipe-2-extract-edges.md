# Recipe 2: Extract edges

Extract Brep edge curves, optionally separated by topology.

```text
Brep -> Deconstruct Brep -> Edges, Faces, Vertices
Brep -> Brep Edges ------> Naked, Interior, Non-manifold edge sets
```

Use Deconstruct Brep for all edges. Brep Edges separates edges by [adjacency](https://developer.rhino3d.com/api/rhinocommon/rhino.geometry.edgeadjacency?version=8.x), not outer boundary versus hole loops. Both an outer boundary and a hole boundary can be naked edges. For loop classification, inspect Brep face loops.

Output is edge curves, with branches determined by the inputs. Adjacent unjoined patches can produce coincident edge curves; deduplicate when the goal is one member per shared edge before [piping](./recipe-5-pipe-sweep.md).
