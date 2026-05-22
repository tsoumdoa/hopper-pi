# Python Boilerplate for Grasshopper Script Components

Use this as a minimal template for Grasshopper Python script components.

```python
import ghpythonlib.treehelpers as th

# x is assumed to be a Grasshopper data tree input
nested = th.tree_to_list(x)

# Example: flatten one level into a simple Python list
result = []
for branch in nested:
    if isinstance(branch, list):
        result.extend(branch)
    else:
        result.append(branch)
a = result
```
