import { firecrawlPlugin } from "./firecrawl/index.js";
import { validatePlugins, type ToolPlugin } from "./types.js";

/** Add or remove bundled plugins here. Preferences for absent plugins are retained. */
export const TOOL_PLUGINS: readonly ToolPlugin[] = [firecrawlPlugin];
validatePlugins(TOOL_PLUGINS);
