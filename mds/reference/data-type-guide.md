# Data types and panel values

Use for conversion failures and text inputs. Check the receiving port's type and item/list/tree access before changing data. Do not assume conversions are bidirectional or preserve geometry; use an explicit construction component when shape or orientation matters.

## Panel output

| `textOutput` | Data | Typical use |
|--------------|------|-------------|
| `singleString` | Entire text as one string, including newlines | Labels, paths, a domain such as `0 to 1` |
| `oneItemPerLine` | One string item per line | Lists of numbers, points, or Boolean pattern values |

`gh_apply_graph` defaults to `singleString`. `gh_create_widget` panel creation and `gh_mutate_widget` panel `setProperty` require `textOutput` explicitly. Downstream ports still need to parse or cast the strings.

Use `{0,0,0}` for point/vector text and `-5 to 5` for a domain. For preview color, prefer a Colour Swatch over a text-to-material cast. For Isotrim, feed Divide Domain² with the surface's actual UV domain, then use its subdomains.

For Python tree/list access and conversion errors, read [python-boilerplate.md](./python-boilerplate.md#list-vs-tree-access-types). Inspect the failing port and runtime message; a Goo conversion error alone does not identify the cause.
