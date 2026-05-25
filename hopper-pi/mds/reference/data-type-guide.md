# Data Type Guide — Casting, Construction & Tips

> **When to use this file:** Load when you need to connect mismatched
> parameter types, construct input data, or figure out type conversions
> between components.

## Safe Type Casts

In Grasshopper, some data types can be cast safely by using appropriate
parameter components. These patterns can also act as lightweight type checks.

- line <-> polyline
- point <-> plane
- closed polyline <-> surface
- rectangle <-> 2D domain
- planar surface <-> 2D domain
- vector <-> line
- color <-> material

Also remember:
- a line is defined by two points
- a plane is typically defined from an origin and orientation, not simply as
  three arbitrary points

## Input Construction Tips

- point and vector can be donated as `{0,0,0}` on panel
- domain can be defined using panel as `<start> to <end_num>` e.g.: `-5 to 5`
  or `0 to 1`
- D in IsoTrim requires output from Divide Domain2 (surface can be represented
  as domain)
- Graph mapper works only with normalized values (0–1), also need to ask the
  user to set the mapper manually
- Color/material can be donated as rgba string (0–255) `255,105,180` or
  `255,105,180 (152)`
