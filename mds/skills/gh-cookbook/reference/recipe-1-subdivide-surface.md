# Recipe 1: Subdivide surface

Split a surface's UV domain into U×V patches.

```text
Surface UV domain ----------------> Divide Domain² domain
U count, V count -----------------> Divide Domain² counts
Surface --------------------------> Isotrim surface
Divide Domain² subdomains --------> Isotrim domain
```

Use positive integer counts and the surface's actual domain. If reparameterizing, use the same domain for subdivision and Isotrim. UV subdivision does not guarantee equal physical patch sizes or preserve arbitrary trims.

For one untrimmed rectangular surface, expect `U × V` patches. Inspect branches when processing multiple surfaces. Continue with [extrusion](./recipe-4-extrude.md), [dispatch](./recipe-6-dispatch-pattern.md), or [edges](./recipe-2-extract-edges.md).
