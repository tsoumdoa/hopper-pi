# Tool settings and credentials

Hopper's embedded host and external Pi extension share one application profile. Tool preferences live in `tool-settings.json` under:

- macOS: `~/Library/Application Support/hopper-pi`
- Windows: `%APPDATA%\hopper-pi`
- Linux: `$XDG_CONFIG_HOME/hopper-pi`, or `~/.config/hopper-pi`

External Pi accepts `--hopper-config-dir /absolute/path`; the embedded host accepts `--tool-config-dir /absolute/path`. An explicit configuration directory selects another profile. Profiles do not synchronize. Preferences contain only a random credential reference and generation, never an API key. Environment variables do not supply plugin credentials.

macOS stores keys in Keychain and Windows uses Credential Manager through the pinned `@napi-rs/keyring` native binding. Linux uses Secret Service through libsecret's `secret-tool` utility. Install that utility and unlock the desktop credential store before setup. Hopper passes keys through stdin, not command arguments. Missing or locked protected storage blocks enabled Firecrawl tools; there is no plaintext fallback. When Firecrawl or both of its tools are disabled, settings and model-request refreshes use the saved reference for setup display without reading protected storage. Credential-status waits time out after two seconds and release early on observed settings changes, session replacement, or shutdown. A timeout marks enabled Firecrawl tools unavailable for that refresh; later refreshes can recover. Native credential reads may continue after the caller stops waiting, but late results cannot restore exposure. Enabling or executing Firecrawl checks protected storage again. Linux deliberately avoids the binding's automatic fallback to a nonpersistent kernel keyring.

Credential entries use a plugin- and profile-scoped service identifier and a fresh random account identifier for each save. Replacements publish only if the policy revision has not changed since setup began. Removal publishes a tombstone before deletion. A deletion failure therefore leaves the old entry unusable, and repeating removal retries deletion within the current host process. Interrupted saves can leave orphaned protected entries, but these cannot authorize a request.

All settings updates and execution admissions use the same native whole-file lock. `@lickle/lock` uses `flock` on macOS and Linux, and `LockFileEx` on Windows. The operating system releases locks when an owner process dies. A five-second acquisition timeout blocks the operation; it does not steal the lock. The lock file is permanent and must not be removed while Hopper is running.

The pinned locking package supplies binaries for macOS arm64 and x64, Windows x64, and Linux x64 with glibc. Other targets fail closed. The Rhino package builder includes the target lock and keyring binaries, removes off-target copies, and requires both addons during package verification.

A separate `tool-settings.initialized` marker is written before initial settings creation. Missing settings in an initialized profile require explicit repair. Invalid or future schemas also block execution. Schema version 2 migrates valid version 1 settings under the lock, preserving Firecrawl preferences and its exact protected-store reference. Hosts sharing a profile must all support version 2 after migration. Adding a plugin or tool appends its missing defaults and advances the revision under the lock; existing choices, epoch, and credential reference are preserved. Removed plugins and tools retain their stored preferences and credential references for other hosts and later reinstalls. Every stored gate is validated, including retired IDs. Repair preserves the damaged settings in a uniquely named backup, starts a new epoch with Firecrawl disabled, and requires credential setup again. It never adopts an old protected entry.

Offline verification covers competing hosts, stale revisions, interrupted initialization, deletion while running, corrupt settings, credential publication races, deletion failure, and real process death while holding the native lock. Owner-death execution has been verified on the development Mac. Windows/Linux native execution and real OS credential writes still need platform smoke checks; no Firecrawl key or provider integration call is needed for those checks.

Implementation references: [native locking source](https://github.com/Pingid/lickle-lock), [keyring binding](https://github.com/Brooooooklyn/keyring-node), and [the binding's Linux fallback](https://github.com/Brooooooklyn/keyring-node/blob/main/src/linux_credential_builder.rs).

In external Pi, run `/hopper-tools` without arguments. The interactive menu controls groups and tools, session activation, connection checks, defaults and repair. Firecrawl setup uses a masked terminal form. Enable the plugin with its group switch and save its key through "Manage API key". Saving a key preserves the switch. Tools that need credentials stay blocked until a key is configured. RPC users manage settings through the Hopper app's Agent tools dialog. Never put an API key in a slash-command argument.

See [bundled plugins](plugins.md) for the registry, credential contract, and add/remove workflow.
