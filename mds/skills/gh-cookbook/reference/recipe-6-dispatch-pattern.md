# Recipe 6: Dispatch pattern

Split an ordered list into A and B using a repeating Boolean pattern.

```text
Input list -----------------> Dispatch list
Boolean panel --------------> Dispatch pattern
Dispatch A, Colour Swatch A -> Custom Preview A
Dispatch B, Colour Swatch B -> Custom Preview B
```

Set the panel's `textOutput` to `oneItemPerLine`. Put `true` and `false` on separate lines for alternating items; `true, true, false, false` gives pairs when entered one value per line.

The outputs contain items matching true and false within each input branch. A 2D checkerboard needs row/column parity, such as `(row + column) % 2 == 0`; a repeating AB list alone can produce stripes depending on row length and branch structure.
