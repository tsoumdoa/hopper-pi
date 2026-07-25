# Hopper Tool Schema Sizes

Generated with `description.length + JSON.stringify(parameters).length`.

## Tools

| Tool | Characters |
|------|-----------:|
| `rh_run_script` | 658 |
| `rh_query_objects` | 685 |
| `rh_view_control` | 2,073 |
| `gh_apply_graph` | 4,453 |
| `gh_param_rhino` | 999 |
| `gh_create_widget` | 1,219 |
| `gh_mutate_widget` | 1,265 |
| `gh_edit_components` | 719 |
| `gh_edit_param` | 2,557 |
| `gh_edit_wire` | 508 |
| `gh_edit_group` | 774 |
| `gh_edit_script` | 3,350 |
| `gh_get_canvas` | 285 |
| `gh_list_components` | 570 |
| `gh_get_canvas_errors` | 111 |
| `hopper_load_tools` | 390 |
| `rh_capture_view` | 885 |

## Active routes

| Route | Characters | Budget |
|-------|-----------:|-------:|
| `default` | 5,809 | 12,000 |
| `canvas_edits` | 10,294 | 18,000 |
| `script_edits` | 11,716 | 22,000 |
| `rhino_document` | 9,225 | 18,000 |
| `rhino_references` | 6,808 | 18,000 |
| `mixed_canvas_script` | 16,201 | 18,000 |
| `mixed_canvas_rhino` | 14,709 | 18,000 |
| `mixed_script_rhino` | 16,131 | 18,000 |
| `capture_default` | 6,694 | 12,000 |
| `capture_mixed_canvas_script` | 17,086 | 18,000 |
| `capture_mixed_script_rhino` | 17,016 | 18,000 |

Legacy definitions combined: 15,773 / 36,000.
Pre-refactor legacy baseline: 42,508 characters.
