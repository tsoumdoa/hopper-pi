import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Catalog groups for Hopper tools (registration, search, diagnostics). */
export type HopperToolGroup = "rhino" | "gh-read" | "gh-edit" | "gh-script" | "interaction";

/** Prerequisite gate surfaced in search/diagnostics (activation still follows runtime policy). */
export type HopperToolRequires = "backend" | "images" | "ui";

/**
 * Metadata wrapper around a Pi tool definition.
 * The catalog is the single source of truth for registration policy, keywords,
 * initial activation, prerequisites, and diagnostics.
 */
export type HopperToolCatalogEntry = {
	tool: ToolDefinition;
	group: HopperToolGroup;
	keywords: string[];
	alwaysActive?: boolean;
	requires?: HopperToolRequires;
};
