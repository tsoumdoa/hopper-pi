# Skills and Markdown

Open **Skills & Markdown** in the sidebar to inspect the bundled skills, preview their Markdown and reference files, or turn individual skills off. Enabled skills appear in the agent's skill catalog; the agent can load relevant files with a restricted `read` tool. This tool only reads enabled Markdown in this library. Pi's general shell, edit, and write tools remain disabled.

To add your own instructions:

1. Copy the **Your Markdown folder** path from the panel and open it in Finder or File Explorer.
2. Save or drop `.md` files there. Plain Markdown works; the filename becomes the skill name and the first non-empty line becomes its description.
3. The panel refreshes every three seconds while Hopper is idle. The host also scans before a new prompt, so the panel does not need to stay open.

For instructions with references, create a folder containing `SKILL.md` and related Markdown files. Optional YAML frontmatter sets the name and description:

```markdown
---
name: office-modeling
description: Office standards for architectural models, units, and layer names.
---

# Office modeling standards
Use meters. Follow the layer names in [layers.md](./layers.md).
```

Markdown under a `SKILL.md` folder belongs to that skill and is disabled with it. Other Markdown files, including those in subfolders, are listed individually. Symbolic links and non-Markdown files are skipped. Each file is limited to 256 KiB, with up to 500 Markdown files in the library. Discovery errors appear in the panel.

The default drop folder is `<pinned shared data directory>/skills`. On macOS this is `~/Library/Application Support/hopper-pi/host/shared-host/skills`; on Windows it is `%APPDATA%/hopper-pi/host/shared-host/skills`. To use an existing folder elsewhere, enter its absolute path in the panel and choose **Use folder**. Paths beginning with `~/` also work. Keep this folder separate from the bundled skill directories.

The host saves the folder and disabled skill IDs in `<pinned shared data directory>/skills-settings.json`, shared by Hopper windows using that data directory. If multiple windows save settings simultaneously, the last save wins. Changes apply at the next idle refresh or prompt, and controls are disabled while a turn is running. Disabling a skill removes it from discovery and prevents further reads through `read`; it does not remove text already in conversation history. Start a new session for a clean context. The read restriction applies to this file-reading tool, not to scripts executed inside Rhino.

Skill choices survive restarts. Skills are enabled unless their ID appears in the saved `disabled` list; turning one back on removes its ID. The model picker saves the selected provider and model as `defaultProvider` and `defaultModel` in `<host data directory>/agent/settings.json`. New sessions use that selection when its provider is authenticated and the model is available. Resuming an existing conversation restores that conversation's model first.

On Windows, press **Win+R**, enter `%APPDATA%\hopper-pi\host`, and press Enter. This normally opens `C:\Users\<username>\AppData\Roaming\hopper-pi\host`:

| Relative path | Saved content |
| --- | --- |
| `shared-host\skills\` | Custom Markdown files, unless you chose another folder |
| `shared-host\skills-settings.json` | Custom folder path and disabled skill IDs |
| `agent\settings.json` | Last selected provider/model and Pi preferences |

On macOS, these files are under `~/Library/Application Support/hopper-pi/host`. A host launched with `--data-dir` stores its journal and skills under that directory's `shared-host` subdirectory. Once initialized, control state pins that location. Changing the custom Markdown folder does not move the settings files.
