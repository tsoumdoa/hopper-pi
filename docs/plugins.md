# Bundled tool plugins

Add or remove providers in `src/plugins/registry.ts`. Firecrawl uses the same plugin interface as any future provider. The registry supplies registration, discovery metadata, policy defaults, credential storage, cancellation, and the web and terminal settings controls.

## Add a plugin

1. Create `src/plugins/<id>/index.ts` and export a `ToolPlugin` from `src/plugins/types.ts`.
2. Declare its stable ID, display name, description, keywords, and default enablement. Providers that send user data or consume credits should start disabled.
3. Declare the tool inventory and implement `create(context)`. Return the tool definitions plus `abortTool(name)` and `abortAll()`. The factory's tool names must match the inventory exactly.
4. Import the plugin in `src/plugins/registry.ts` and add it to `TOOL_PLUGINS`.

For example, the registry becomes:

```ts
import { firecrawlPlugin } from "./firecrawl/index.js";
import { examplePlugin } from "./example/index.js";
import { validatePlugins, type ToolPlugin } from "./types.js";

export const TOOL_PLUGINS: readonly ToolPlugin[] = [firecrawlPlugin, examplePlugin];
validatePlugins(TOOL_PLUGINS);
```

Use lowercase plugin IDs such as `example-provider`. Each inventory entry has a stable preference ID such as `example-provider.tool.lookup`, a Pi tool name, `owner` and `parent` equal to the plugin ID, `defaultActive`, and `requirements`. Do not reuse a retired plugin or tool ID for a different operation. Duplicate IDs and tool names fail validation. A collision with an already registered external Pi tool blocks the whole plugin before registration.

`defaultEnabled` controls the saved parent preference for a new installation. `defaultActive` controls initial exposure in progressive discovery mode. Changing either default does not overwrite existing saved preferences.

No edits to `src/index.ts`, policy code, or settings components are needed for another provider. The host derives its catalog and settings metadata from the registry. Discovery groups use `plugin:<id>` so they cannot collide with built-in catalog groups.

## Credentials and requests

Omit `credential` for a plugin that needs no key. For a provider with one API key, declare `credential: { label, notice }`. The label identifies the input; the notice explains what is sent to the provider and any account charges. Mark each tool that needs the key with `requirements: ["credential"]`. Tools in the same plugin can operate without that requirement. The web and terminal parent switches enable the plugin independently of key setup, so credential-free tools can run immediately. Activating a credential-free tool does not query protected credential storage. Use Manage API key separately for tools that require it.

Call `await context.admit(toolName, signal)` immediately before every provider request, after asynchronous preparation. It checks current permissions, the originating session, and the plugin's protected credential entry. It returns `{ apiKey }`, with an empty string for a tool that needs no credential. Never cache or expose the key. Keep provider URLs, payloads, response processing, error redaction, timeouts, and request cancellation inside the plugin adapter. Firecrawl's client is the reference implementation.

Cancellation methods must be idempotent and safe when no calls are pending. Disabling a plugin cancels its pending work; disabling a tool or removing its key cancels the affected tools. Session replacement and shutdown cancel every plugin. Cancellation is best effort: a provider may finish a request it already admitted.

Keys use separate protected-store services for each plugin and profile. A save targets an explicit `pluginId`; a stale version fails without replay. Settings store only credential references and generations. Web and terminal controls both use the plugin's credential metadata. The initial interface supports one API key per plugin; OAuth and multiple credential fields would need an interface extension.

## Disable or remove

The Agent tools parent switch disables execution and preserves each child's preference. It takes effect for subsequent admissions after the settings save succeeds.

To remove a bundled provider, remove its import and registry entry and restart the host. Its module can then be deleted. It will no longer be constructed, registered, or displayed. This is a startup registry, with no package installer or live module unloading.

Removal retains stored preferences and credential references for reinstalls and other hosts sharing the profile. Reinstalling restores those choices, including an enabled parent. To disconnect a key, use **Remove key** before removing the provider. Reset disconnects all saved key references, including those for absent plugins; it does not delete orphaned protected entries.

## Settings upgrades

Schema version 2 stores plugin groups and credentials by ID. The store migrates valid version 1 Firecrawl settings under the same lock as other updates. It preserves the epoch, tool preferences, credential generation, and exact protected-store reference, then advances the revision once. Firecrawl's protected-store service name is unchanged, so no key reentry is required solely for migration.

New registry entries append missing defaults under the lock. Absent entries remain valid and retain their preferences. Unknown fields inside a gate or credential remain invalid; keys cannot be stored in ordinary settings.

Hosts from before schema version 2 cannot read the upgraded profile. Upgrade all hosts sharing that profile together. Future plugin additions and removals within version 2 do not require a schema change.

## Verification

`src/plugins/plugins.test.ts` adds an Example provider through the same interface and checks registration, discovery metadata, independent keys, cancellation, credential-free tools, settings migration, removal, and reinstalls. The web and terminal component tests exercise Example setup with its own label, notice, and plugin ID. Terminal groups with duplicate display names include their stable IDs so selecting one cannot target another provider. The existing Firecrawl and real Pi SDK tests cover request boundaries, races, and external tool collisions.

Run `pnpm test` and `pnpm build` after changing the registry or shared interface. Provider adapter tests should inject responses and avoid real account charges.
