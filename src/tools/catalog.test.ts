import assert from "node:assert/strict";
import { test } from "vitest";
import {
	ALL_TOOLS,
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	buildCatalogSizeReport,
	type HopperToolCatalogEntry,
} from "./catalog.js";
import {
	activateSearchMatches,
	type ActivateSearchMatchesResult,
	createHopperSearchToolsTool,
	rankHopperTools,
} from "./hopper-search-tools.js";

function withSearchCatalog(): HopperToolCatalogEntry[] {
	const searchTool = createHopperSearchToolsTool(
		{
			getAllTools: () => [],
			getActiveTools: () => [],
			setActiveTools: () => {},
		} as never,
		() => HOPPER_REGISTERED_CATALOG,
		{ allowedToolNames: async () => new Set(), activateByName: async () => {} },
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

test("always-active core matches issue policy plus canvas errors", () => {
	const catalog = withSearchCatalog();
	const core = catalog.filter(entry => entry.alwaysActive).map(entry => entry.tool.name).sort();
	assert.deepEqual(core, [
		"gh_get_canvas",
		"gh_get_canvas_errors",
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

test("discovery reaches inactive tools after ten active or unavailable matches", async () => {
	const catalog = Array.from({ length: 12 }, (_, index) => ({
		...HOPPER_REGISTERED_CATALOG[0],
		tool: { ...HOPPER_REGISTERED_CATALOG[0].tool, name: `tool_${String(index).padStart(2, "0")}` },
		keywords: ["review"],
	}));
	for (const active of [[], catalog.slice(0, 10).map(entry => entry.tool.name)]) {
		const activated: string[] = [];
		const result = await activateSearchMatches({ getActiveTools: () => active }, catalog, "review", {
			registeredNames: new Set(catalog.slice(10).map(entry => entry.tool.name)),
			limit: 1,
			activate: async name => { activated.push(name); },
		});
		assert.deepEqual(activated, ["tool_10"]);
		assert.deepEqual(result.added, ["tool_10"]);
		assert.equal(result.truncated, true);
	}
});

test("activateSearchMatches is additive and respects limit", async () => {
	const catalog = withSearchCatalog();
	let active = ["read", "rh_run_script", "hopper_search_tools", "gh_get_canvas"];
	const pi = {
		getActiveTools: () => active,
		setActiveTools(names: string[]) {
			active = names;
		},
	};
	const registered = new Set(catalog.map((entry) => entry.tool.name));

	const first = await activateSearchMatches(pi, catalog, "viewport camera", {
		registeredNames: registered,
		activate: async name => { active.push(name); },
		limit: 2,
	});
	assert.ok(first.added.includes("rh_view_control"));
	assert.ok(active.includes("read"));
	assert.ok(active.includes("rh_run_script"));
	assert.ok(active.includes("rh_view_control"));

	const beforeSecond = [...active];
	const second = await activateSearchMatches(pi, catalog, "viewport camera", {
		registeredNames: registered,
		activate: async name => { active.push(name); },
		limit: 2,
	});
	assert.deepEqual(second.added, []);
	assert.ok(second.alreadyActive.includes("rh_view_control"));
	assert.deepEqual(active, beforeSecond);
});

test("activateSearchMatches skips unregistered image-gated tools", async () => {
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

	const result = await activateSearchMatches(pi, catalog, "screenshot viewport capture", {
		registeredNames: registered,
		activate: async name => { active.push(name); },
		limit: 5,
	});
	assert.ok(result.skippedUnavailable.includes("rh_capture_view"));
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
	const searchTool = createHopperSearchToolsTool(pi as never, () => catalog, {
		allowedToolNames: async () => new Set(catalog.map(entry => entry.tool.name)),
		activateByName: async name => { active.push(name); },
	});

	const result = await searchTool.execute(
		"tool-call",
		{ query: "screenshot viewport capture" },
		undefined,
		undefined,
		{ model: { provider: "test", id: "text", input: ["text"] } } as never,
	);

	const details = result.details as ActivateSearchMatchesResult;
	assert.ok(details.skippedUnavailable.includes("rh_capture_view"));
	assert.ok(!active.includes("rh_capture_view"));
});

test("catalog size report includes groups and bytes", () => {
	const report = buildCatalogSizeReport(withSearchCatalog());
	assert.ok(report.toolCount >= ALL_TOOLS.length + 1);
	assert.ok(report.totalBytes > 0);
	assert.ok(report.byGroup.rhino.count > 0);
	assert.ok(report.byGroup["gh-script"].count > 0);
	assert.ok(report.tools[0].totalBytes >= report.tools.at(-1)!.totalBytes);
});

test("catalog entries have unique registration names and search keywords", () => {
	const catalog = withSearchCatalog();
	const names = catalog.map((entry) => entry.tool.name);
	assert.equal(new Set(names).size, names.length);
	for (const entry of catalog) {
		assert.ok(entry.keywords.length > 0, `${entry.tool.name} should have search keywords`);
	}
});


test("discovery reports successful activations when another tool becomes unavailable", async () => {
	const catalog = withSearchCatalog();
	const active = ["read"];
	const attempted: string[] = [];
	const tool = createHopperSearchToolsTool({
		getAllTools: () => catalog.map(entry => entry.tool),
		getActiveTools: () => active,
	} as never, () => catalog, {
		allowedToolNames: async () => new Set(["rh_view_control", "rh_capture_view"]),
		activateByName: async name => {
			attempted.push(name);
			if (name === "rh_capture_view") throw new Error("disabled during search");
			active.push(name);
		},
	});
	const result = await tool.execute("search", { query: "rh_capture_view viewport", limit: 1 },
		undefined, undefined, { model: { input: ["text", "image"] } } as never);
	const details = result.details as ActivateSearchMatchesResult;
	assert.deepEqual(details.added, ["rh_view_control"]);
	assert.deepEqual(details.skippedUnavailable, ["rh_capture_view"]);
	assert.deepEqual(attempted, ["rh_capture_view", "rh_view_control"]);
	assert.deepEqual(active, ["read", "rh_view_control"]);
});

test("discovery omits tools disabled by saved policy", async () => {
	const catalog = withSearchCatalog();
	const tool = createHopperSearchToolsTool({
		getAllTools: () => catalog.map(entry => entry.tool),
		getActiveTools: () => [],
	} as never, () => catalog, {
		allowedToolNames: async () => new Set(),
		activateByName: async () => { assert.fail("disabled tools must not be activated"); },
	});
	const result = await tool.execute("search", { query: "viewport" },
		undefined, undefined, { model: { input: ["text", "image"] } } as never);
	assert.deepEqual((result.details as ActivateSearchMatchesResult).matches, []);
});
