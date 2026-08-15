export type FrozenToolContract = {
	name: string;
	title: string;
	parameterSchemaSha256: string;
	descriptionSha256: string;
	resultContent: readonly ("text" | "image")[];
};

/**
 * Public Hopper operations at the Pi-to-MCP migration boundary.
 *
 * Hashes deliberately cover the exact legacy description and input schema. They
 * keep the fixture reviewable while still detecting any contract drift.
 */
export const FROZEN_HOPPER_TOOLS: readonly FrozenToolContract[] = [
	{ name: "gh_apply_graph", title: "Apply Graph", parameterSchemaSha256: "63e6e31d92cba9e75eb9242a2a3f59dda2b13b8c823b4e93bd07ba5788a144dc", descriptionSha256: "666ba98256c083dd137141efc5b7fe12cf163558cc5ebb1c9d1f3121ed7d6bb5", resultContent: ["text"] },
	{ name: "gh_create_widget", title: "Create Widget", parameterSchemaSha256: "05c36504856b46c14b4b5f025f9aba593abdc5c5f1f48c62d4b861f97916f5e8", descriptionSha256: "a8cd0f5ae83b17d30f41e11aacfeff0fafb9ac40fb67f08d2316d3cef6296b28", resultContent: ["text"] },
	{ name: "gh_edit_components", title: "Edit Components", parameterSchemaSha256: "eb99d594337fe046232ce525d336eb4d619423353cbdb5fcd1a6fdbd81fc8f04", descriptionSha256: "2fce5515986b0b5ce1870b011ad465163b54733245267425d918f4ea5e5aa127", resultContent: ["text"] },
	{ name: "gh_edit_group", title: "Edit Group", parameterSchemaSha256: "27db82ebe9b51de3402e0e32c25bbd806e0ca7df92837514dff1c3855d8344fa", descriptionSha256: "c52607aa508d0115a08f5316c1991748cdfdd8cadf36d2727b3e7082f3e3c26b", resultContent: ["text"] },
	{ name: "gh_edit_param", title: "Edit Script Ports", parameterSchemaSha256: "f8926ff1dbcb1f2423a8794df4a5b536f2bac0bb3927cf38fc653342e9bd97a2", descriptionSha256: "d2a59e7b3b5972d0b11f08ab9dfc9460fef88ee4037b425a80467313d5fc23e7", resultContent: ["text"] },
	{ name: "gh_edit_script", title: "Edit Script", parameterSchemaSha256: "d4a59d9ec1272f68efaf151f61d287ee0fd2164046873cc191fc412011a7d215", descriptionSha256: "a10c4e5512bdaa732fafe6eb6d982fed963d71984e5fe17c7952da92cee0fbe3", resultContent: ["text"] },
	{ name: "gh_edit_wire", title: "Edit Wire", parameterSchemaSha256: "de285b570360d1cca0f6366ef01aff491dcb992f455d0e550f2ce6cebf360ab3", descriptionSha256: "1f30d0389d5b75d9fcf7c887cf896473c9c1e5a3314aefd86248e7a1dd6b4965", resultContent: ["text"] },
	{ name: "gh_get_canvas", title: "Get Canvas", parameterSchemaSha256: "f552504771175007182cf028c1d1d0c2091d079db9da3a5fe70d6a57f21b174c", descriptionSha256: "e06f56e42b069f3b937dbf8f0eb2b0808853a54a2fa2e2fa13e234df88c09b6e", resultContent: ["text"] },
	{ name: "gh_get_canvas_errors", title: "Get Canvas Errors", parameterSchemaSha256: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259", descriptionSha256: "cb354792fceb7f0607ed8207a12884c0a12f9cbccba4ac3eb5e9a4d6539ee890", resultContent: ["text"] },
	{ name: "gh_list_components", title: "List Components", parameterSchemaSha256: "f140c88657463bf31df209de793a6b940e42789b6313a48cb76e89973ca6d3d2", descriptionSha256: "bdaf7be08e9c5e4e8359bb278edc5800a5a08e1af7c67bf52961c92b6a1135ca", resultContent: ["text"] },
	{ name: "gh_mutate_widget", title: "Mutate Widget", parameterSchemaSha256: "b180d07fdc63aae65ea529287e64eeb78b22663937a2ab801a278cbdf84d1df3", descriptionSha256: "cfa03232aff137c744e8d74aeea2728a9cd33d12fbc48a3ae8ba16c5728db7bf", resultContent: ["text"] },
	{ name: "gh_param_rhino", title: "Param Rhino Geometry", parameterSchemaSha256: "c5bdfac44f76014a29c6a5912d914ebfade98b1326047ecb2a65cbb590425c1b", descriptionSha256: "b1eae04e4f9ca2873d2b32e26cf1508a4d507a14f395498a02952d08faaa2fa2", resultContent: ["text"] },
	{ name: "rh_capture_view", title: "Capture Rhino View", parameterSchemaSha256: "86b71c0044684006f9249c6c7e60ecff666eb03b66c33b471fac3d000e0503f1", descriptionSha256: "7ba5ea883da4e8a1f25082d2cc63358c28498a6c13db37a5fa4da0e7c577f3c1", resultContent: ["text", "image"] },
	{ name: "rh_query_objects", title: "Query Rhino Objects", parameterSchemaSha256: "6042ebc8b9f070a0620b70aa8859595e9da1b9543af09214f9d6d1137640d6ce", descriptionSha256: "a140838a211b77f810f758db369245a28ed2ebbae9399471052dc3622bfec886", resultContent: ["text"] },
	{ name: "rh_run_script", title: "Run Rhino Script", parameterSchemaSha256: "c2372b9d8b85ffec845ad37f16963606b64c74fcf748bc4e9591f0a79f116dc4", descriptionSha256: "d55b6e1269a14943d1879004121575b1fb8cd840d1a069e6520bea3ebb875223", resultContent: ["text"] },
	{ name: "rh_view_control", title: "Control Rhino View", parameterSchemaSha256: "da7fedece7acb5bd631f073c2675530baf35a2155e35a662dadd5fe622aafd5c", descriptionSha256: "73389f9bb44bf92b9b255c414ece21948d81a565c477ad3eb04ea4f342f8e06b", resultContent: ["text"] },
];

export const PI_ONLY_TOOLS = ["ask_user", "hopper_search_tools", "pick_option"] as const;

export const LEGACY_RESULT_FIXTURES = {
	success: {
		content: [{ type: "text", text: "OK" }],
		details: {},
	},
	failure: {
		content: [{ type: "text", text: "ERROR: backend unavailable" }],
		details: {},
	},
} as const;

export const LEGACY_TOOL_RESULT_FIXTURES = Object.fromEntries(
	FROZEN_HOPPER_TOOLS.map((tool) => [tool.name, {
		success: tool.name === "rh_capture_view"
			? {
				content: [
					{ type: "text", text: "Captured Rhino viewport Perspective." },
					{ type: "image", data: "<base64-png>", mimeType: "image/png" },
				],
				details: {},
			}
			: LEGACY_RESULT_FIXTURES.success,
		failure: LEGACY_RESULT_FIXTURES.failure,
	}]),
) as Readonly<Record<string, {
	success: typeof LEGACY_RESULT_FIXTURES.success | {
		content: readonly [
			{ readonly type: "text"; readonly text: "Captured Rhino viewport Perspective." },
			{ readonly type: "image"; readonly data: "<base64-png>"; readonly mimeType: "image/png" },
		];
		details: Record<string, never>;
	};
	failure: typeof LEGACY_RESULT_FIXTURES.failure;
}>>;

export const BACKEND_PROTOCOL_INVENTORY = {
	controlRequests: ["ping", "submitJob"],
	queuedCommands: [
		"addComponent", "addGroup", "addScriptInput", "addScriptOutput",
		"beginAgentTransaction", "beginRhinoAgentTransaction", "cancelAgentTransaction",
		"cancelRhinoAgentTransaction", "changeGroupColor", "changeGroupStyle",
		"commitAgentTransaction", "commitRhinoAgentTransaction", "connectWire",
		"createPanel", "createScribble", "createScriptNode", "createSlider", "createSwatch",
		"createToggle", "createValueList", "deleteComponent", "deleteGroup", "disconnectWire",
		"editParamProps", "editSliderRange", "getScriptCode", "listScriptParams",
		"moveComponent", "removeFromGroup", "removeScriptInput", "removeScriptOutput",
		"renameComponent", "renameGroup", "setComponentHidden", "setComponentLocked",
		"setPanelParams", "setPanelText", "setParamRhinoGeometry", "setScribbleText",
		"setScriptCode", "setSliderValue", "setSwatchColor", "setToggleValue",
		"setValueListSelected", "syncScriptParams",
	],
	synchronousRequests: [
		"applyGraph", "captureRhinoView", "controlRhinoView", "getCanvasErrors",
		"getCurrentCanvas", "getParamRhinoGeometry", "getScriptCode", "listAllComponents",
		"listScriptParams", "queryRhinoObjects", "runRhinoScript",
	],
	publishedEvents: ["gh.event.xml", "gh.job.status"],
} as const;
