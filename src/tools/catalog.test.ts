import assert from "node:assert/strict";
import { test } from "vitest";
import {
	ALL_TOOLS,
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	buildCatalogSizeReport,
	getAlwaysActiveToolNames,
	type HopperToolCatalogEntry,
} from "./catalog.js";
import {
	activateSearchMatches,
	type ActivateSearchMatchesResult,
	createHopperSearchToolsTool,
	parseProgressiveResetReason,
	rankHopperTools,
	resetProgressiveActiveTools,
	shouldResetProgressiveTools,
} from "./hopper-search-tools.js";

function withSearchCatalog(): HopperToolCatalogEntry[] {
	const searchTool = createHopperSearchToolsTool(
		{
			getAllTools: () => [],
			getActiveTools: () => [],
			setActiveTools: () => {},
		} as never,
		() => HOPPER_REGISTERED_CATALOG,
	);
	return [
		...HOPPER_REGISTERED_CATALOG,
		{
			tool: searchTool,
			group: "interaction",
			keywords: ["search tools", "activate", "discover"],
			alwaysActive: true,
		},
		RH_CAPTURE_VIEW_CATALOG_ENTRY,
	];
}

test("catalog covers every ALL_TOOLS entry exactly once", () => {
	const names = HOPPER_REGISTERED_CATALOG.map((entry) => entry.tool.name);
	assert.deepEqual(names, ALL_TOOLS.map((tool) => tool.name));
	assert.equal(new Set(names).size, names.length);
	for (const entry of HOPPER_REGISTERED_CATALOG) {
		assert.ok(entry.keywords.length > 0);
	}
});

test("always-active core matches issue policy plus early scaffold", () => {
	const catalog = withSearchCatalog();
	const core = getAlwaysActiveToolNames(catalog).sort();
	assert.deepEqual(core, [
		"gh_get_canvas",
		"gh_get_canvas_errors",
		"gh_quick_scaffold",
		"hopper_delegate",
		"hopper_search_tools",
		"rh_query_objects",
		"rh_run_script",
	]);
});

test("discoverable registered tools omit promptSnippet and promptGuidelines", () => {
	const discoverable = HOPPER_REGISTERED_CATALOG.filter((entry) => !entry.alwaysActive);
	assert.ok(discoverable.length > 0);
	for (const entry of discoverable) {
		const tool = entry.tool as { promptSnippet?: string; promptGuidelines?: string[] };
		assert.equal(
			tool.promptSnippet,
			undefined,
			`${entry.tool.name} should omit promptSnippet`,
		);
		assert.equal(
			tool.promptGuidelines,
			undefined,
			`${entry.tool.name} should omit promptGuidelines`,
		);
	}
});

test("core registered tools keep promptSnippet", () => {
	const core = HOPPER_REGISTERED_CATALOG.filter((entry) => entry.alwaysActive);
	for (const entry of core) {
		const tool = entry.tool as { promptSnippet?: string };
		assert.ok(tool.promptSnippet, `${entry.tool.name} should keep promptSnippet`);
	}
});

test("rankHopperTools finds heavy tools by capability phrases", () => {
	const catalog = withSearchCatalog();

	const scriptPorts = rankHopperTools(catalog, "edit script ports");
	assert.ok(scriptPorts.matches.some((match) => match.name === "gh_edit_param"));

	const geometry = rankHopperTools(catalog, "reference rhino geometry");
	assert.ok(geometry.matches.some((match) => match.name === "gh_param_rhino"));

	const viewport = rankHopperTools(catalog, "viewport camera");
	assert.ok(viewport.matches.some((match) => match.name === "rh_view_control"));

	const script = rankHopperTools(catalog, "patch csharp script component");
	assert.ok(script.matches.some((match) => match.name === "gh_edit_script"));
});

test("rankHopperTools does not treat short tokens as mid-word hits", () => {
	const catalog = withSearchCatalog();
	const result = rankHopperTools(catalog, "id");
	assert.equal(
		result.matches.some((match) => match.name === "gh_create_widget"),
		false,
	);
});

test("rankHopperTools returns actionable no-match hints", () => {
	const catalog = withSearchCatalog();
	const result = rankHopperTools(catalog, "zzzz-not-a-real-capability-qqq");
	assert.equal(result.matches.length, 0);
	assert.ok(result.noMatch);
	assert.ok(result.noMatch.nearestGroups.length > 0);
	assert.ok(result.noMatch.suggestions.length > 0);
});

test("activateSearchMatches is additive and respects limit", () => {
	const catalog = withSearchCatalog();
	let active = ["read", "rh_run_script", "hopper_search_tools", "gh_get_canvas"];
	const pi = {
		getActiveTools: () => active,
		setActiveTools(names: string[]) {
			active = names;
		},
	};
	const registered = new Set(catalog.map((entry) => entry.tool.name));

	const first = activateSearchMatches(pi, catalog, "viewport camera", {
		registeredNames: registered,
		limit: 2,
	});
	assert.ok(first.added.includes("rh_view_control"));
	assert.ok(active.includes("read"));
	assert.ok(active.includes("rh_run_script"));
	assert.ok(active.includes("rh_view_control"));

	const beforeSecond = [...active];
	const second = activateSearchMatches(pi, catalog, "viewport camera", {
		registeredNames: registered,
		limit: 2,
	});
	assert.deepEqual(second.added, []);
	assert.ok(second.alreadyActive.includes("rh_view_control"));
	assert.deepEqual(active, beforeSecond);
});

test("activateSearchMatches skips unregistered image-gated tools", () => {
	const catalog = withSearchCatalog();
	let active = ["hopper_search_tools"];
	const pi = {
		getActiveTools: () => active,
		setActiveTools(names: string[]) {
			active = names;
		},
	};
	const registered = new Set(
		catalog.map((entry) => entry.tool.name).filter((name) => name !== "rh_capture_view"),
	);

	const result = activateSearchMatches(pi, catalog, "screenshot viewport capture", {
		registeredNames: registered,
		limit: 5,
	});
	assert.ok(result.skippedUnregistered.includes("rh_capture_view"));
	assert.ok(!active.includes("rh_capture_view"));
});

test("hopper_search_tools does not reactivate image-gated tools for text-only models", async () => {
	const catalog = withSearchCatalog();
	let active = ["hopper_search_tools"];
	const pi = {
		getAllTools: () => catalog.map((entry) => ({ name: entry.tool.name })),
		getActiveTools: () => active,
		setActiveTools(names: string[]) {
			active = names;
		},
	};
	const searchTool = createHopperSearchToolsTool(pi as never, () => catalog);

	const result = await searchTool.execute(
		"tool-call",
		{ query: "screenshot viewport capture" },
		undefined,
		undefined,
		{ model: { provider: "test", id: "text", input: ["text"] } } as never,
	);

	const details = result.details as ActivateSearchMatchesResult;
	assert.ok(details.skippedUnregistered.includes("rh_capture_view"));
	assert.ok(!active.includes("rh_capture_view"));
});

test("resetProgressiveActiveTools preserves non-Hopper tools and restores core", () => {
	const catalog = withSearchCatalog();
	let active = [
		"read",
		"bash",
		"ask_user",
		"rh_run_script",
		"rh_view_control",
		"gh_edit_script",
		"hopper_search_tools",
	];
	const pi = {
		getAllTools: () => catalog.map((entry) => ({ name: entry.tool.name })),
		getActiveTools: () => active,
		setActiveTools(names: string[]) {
			active = names;
		},
	};

	const next = resetProgressiveActiveTools(pi as never, catalog);
	assert.ok(next.includes("read"));
	assert.ok(next.includes("bash"));
	assert.ok(next.includes("ask_user"));
	assert.ok(next.includes("rh_run_script"));
	assert.ok(next.includes("rh_query_objects"));
	assert.ok(next.includes("gh_get_canvas"));
	assert.ok(next.includes("gh_get_canvas_errors"));
	assert.ok(next.includes("hopper_search_tools"));
	assert.ok(!next.includes("rh_view_control"));
	assert.ok(!next.includes("gh_edit_script"));
});

test("shouldResetProgressiveTools only on startup/reload/new", () => {
	assert.equal(shouldResetProgressiveTools("startup"), true);
	assert.equal(shouldResetProgressiveTools("reload"), true);
	assert.equal(shouldResetProgressiveTools("new"), true);
	assert.equal(shouldResetProgressiveTools("resume"), false);
	assert.equal(shouldResetProgressiveTools("fork"), false);
	assert.equal(parseProgressiveResetReason(undefined), "startup");
	assert.equal(parseProgressiveResetReason("new"), "new");
	assert.equal(parseProgressiveResetReason("unknown"), "startup");
});

test("catalog size report includes groups and bytes", () => {
	const report = buildCatalogSizeReport(withSearchCatalog());
	assert.ok(report.toolCount >= ALL_TOOLS.length + 1);
	assert.ok(report.totalBytes > 0);
	assert.ok(report.byGroup.rhino.count > 0);
	assert.ok(report.byGroup["gh-script"].count > 0);
	assert.ok(report.tools[0].totalBytes >= report.tools.at(-1)!.totalBytes);
});

test("no duplicate registration names across catalog", () => {
	const catalog = withSearchCatalog();
	const names = catalog.map((entry) => entry.tool.name);
	assert.equal(new Set(names).size, names.length);
});
