# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries below are derived from the project's release history.

## [0.1.5] — View capture & control

### Added

- **`rh_capture_view`** — capture a Rhino viewport screenshot as PNG visual context for visual QA, composition, visibility, and display checks. Permission-gated: only active after you allow Rhino viewport screenshots for the session, and only on models that accept image input.
- **`rh_view_control`** — drive the viewport: switch active / standard / named / CPlane views, set the camera (location, target, lens length, projection), zoom (extents / selected / bounding box), and save named views.
- Per-session viewport-capture consent flow so screenshots are opt-in.

## [0.1.4] — Agent can ask questions

### Added

- **`ask_user`** — ask the user a free-text clarifying question and wait for an answer when requirements are ambiguous.
- **`pick_option`** — present 2–6 informed options to pick from (e.g. resolving ambiguous component matches after `gh_list_components`). An "Other" choice is appended automatically.

### Fixed

- Silent failures on certain operations.
- Long GUIDs leaking into output.
- License corrections.

[0.1.5]: https://github.com/tsoumdoa/hoppercode/releases/tag/v0.1.5
[0.1.4]: https://github.com/tsoumdoa/hoppercode/releases/tag/v0.1.4
