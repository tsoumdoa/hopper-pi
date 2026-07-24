import assert from "node:assert/strict";
import { test } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	applyHopperToolRoute,
	HOPPER_DEFAULT_TOOLS,
	registerHopperToolRouting,
	routeHopperPrompt,
	toolsForHopperGroups,
} from "./hopper-tool-routing.js";

test("routes new GH builds to the compact default surface", () => {
	assert.deepEqual(
		routeHopperPrompt("Build a Grasshopper facade with sliders, components, wires, and a C# script"),
		[],
	);
	assert.deepEqual(toolsForHopperGroups([]), [...HOPPER_DEFAULT_TOOLS]);
});

test("routes existing canvas, script, Rhino, and mixed reference edits", () => {
	assert.deepEqual(
		routeHopperPrompt("Move the selected component and change that slider"),
		["canvas_edits"],
	);
	assert.deepEqual(
		routeHopperPrompt("Patch the existing C# script and rename its input port"),
		["script_edits"],
	);
	assert.deepEqual(
		routeHopperPrompt("Query the Rhino document, change the layer, and set the viewport camera"),
		["rhino_document"],
	);
	assert.deepEqual(
		routeHopperPrompt("Reference the selected Rhino geometry into an existing GH parameter"),
		["rhino_document", "rhino_references"],
	);
});

test("short anaphoric follow-ups retain the previous route", () => {
	assert.deepEqual(routeHopperPrompt("make it wider", ["rhino_document"]), ["rhino_document"]);
	assert.deepEqual(routeHopperPrompt("move it", []), ["canvas_edits"]);
});

test("mixed routes stay within a bounded surface and defer general edits when necessary", () => {
	assert.deepEqual(
		routeHopperPrompt(
			"Patch the existing Python script, move a component, and reference Rhino geometry",
		),
		["script_edits", "rhino_document", "rhino_references"],
	);
});

test("route replacement preserves non-Hopper, choice, and capture tools", () => {
	let active = [
		"read",
		"ask_user",
		"pick_option",
		"rh_capture_view",
		"gh_edit_wire",
		"rh_run_script",
	];
	const pi = {
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			active = names;
		},
	};

	applyHopperToolRoute(pi, ["script_edits"]);

	for (const name of ["read", "ask_user", "pick_option", "rh_capture_view"]) {
		assert.ok(active.includes(name), `${name} should be preserved`);
	}
	assert.ok(active.includes("gh_edit_script"));
	assert.ok(active.includes("gh_edit_param"));
	assert.ok(!active.includes("gh_edit_wire"));
	assert.ok(!active.includes("rh_run_script"));
});

test("input routing keeps the current route and only adds tools during streaming", () => {
	let active = ["read", ...HOPPER_DEFAULT_TOOLS];
	const handlers: Record<string, Array<(event: any) => unknown>> = {};
	const pi = {
		on(name: string, handler: (event: any) => unknown) {
			(handlers[name] ??= []).push(handler);
		},
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			active = names;
		},
	} as unknown as ExtensionAPI;

	registerHopperToolRouting(pi);
	handlers.input[0]({
		text: "Edit the existing Python script",
		source: "interactive",
	});
	assert.ok(active.includes("gh_edit_script"));

	handlers.input[0]({
		text: "Move the selected component",
		source: "interactive",
		streamingBehavior: "followUp",
	});
	assert.ok(active.includes("gh_edit_script"), "streaming route must not remove active script tools");
	assert.ok(active.includes("gh_edit_components"), "streaming route adds the follow-up tools");
});
