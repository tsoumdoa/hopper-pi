/**
 * Frozen before the PR 1 operation migration.
 *
 * The hashes cover the exact UTF-8 bytes returned by JSON.stringify for each
 * current Pi tool's input schema. A deliberate input contract correction must
 * update the matching hash and byte count in the same pull request.
 */
export const PR1_PUBLIC_OPERATION_NAMES = [
	"gh_apply_graph",
	"gh_create_widget",
	"gh_edit_components",
	"gh_edit_group",
	"gh_edit_param",
	"gh_edit_script",
	"gh_edit_wire",
	"gh_get_canvas",
	"gh_get_canvas_errors",
	"gh_list_components",
	"gh_mutate_widget",
	"gh_param_rhino",
	"rh_capture_view",
	"rh_query_objects",
	"rh_run_script",
	"rh_view_control",
] as const;

export const PR1_EXCLUDED_TOOL_NAMES = [
	"ask_user",
	"hopper_search_tools",
	"pick_option",
] as const;

export const PR1_INPUT_SCHEMA_GOLDEN: Record<
	(typeof PR1_PUBLIC_OPERATION_NAMES)[number],
	{ sha256: string; byteLength: number }
> = {
	gh_apply_graph: {
		sha256: "63e6e31d92cba9e75eb9242a2a3f59dda2b13b8c823b4e93bd07ba5788a144dc",
		byteLength: 6296,
	},
	gh_create_widget: {
		sha256: "05c36504856b46c14b4b5f025f9aba593abdc5c5f1f48c62d4b861f97916f5e8",
		byteLength: 3300,
	},
	gh_edit_components: {
		sha256: "eb99d594337fe046232ce525d336eb4d619423353cbdb5fcd1a6fdbd81fc8f04",
		byteLength: 1796,
	},
	gh_edit_group: {
		sha256: "27db82ebe9b51de3402e0e32c25bbd806e0ca7df92837514dff1c3855d8344fa",
		byteLength: 2119,
	},
	gh_edit_param: {
		sha256: "f8926ff1dbcb1f2423a8794df4a5b536f2bac0bb3927cf38fc653342e9bd97a2",
		byteLength: 6654,
	},
	gh_edit_script: {
		sha256: "d4a59d9ec1272f68efaf151f61d287ee0fd2164046873cc191fc412011a7d215",
		byteLength: 10938,
	},
	gh_edit_wire: {
		sha256: "de285b570360d1cca0f6366ef01aff491dcb992f455d0e550f2ce6cebf360ab3",
		byteLength: 577,
	},
	gh_get_canvas: {
		sha256: "f552504771175007182cf028c1d1d0c2091d079db9da3a5fe70d6a57f21b174c",
		byteLength: 398,
	},
	gh_get_canvas_errors: {
		sha256: "8243f0af367f188a376f2c17b5eabe872a2f7a979813e0d4e2be6d594c2aa259",
		byteLength: 33,
	},
	gh_list_components: {
		sha256: "f140c88657463bf31df209de793a6b940e42789b6313a48cb76e89973ca6d3d2",
		byteLength: 640,
	},
	gh_mutate_widget: {
		sha256: "b180d07fdc63aae65ea529287e64eeb78b22663937a2ab801a278cbdf84d1df3",
		byteLength: 3653,
	},
	gh_param_rhino: {
		sha256: "c5bdfac44f76014a29c6a5912d914ebfade98b1326047ecb2a65cbb590425c1b",
		byteLength: 4545,
	},
	rh_capture_view: {
		sha256: "86b71c0044684006f9249c6c7e60ecff666eb03b66c33b471fac3d000e0503f1",
		byteLength: 802,
	},
	rh_query_objects: {
		sha256: "6042ebc8b9f070a0620b70aa8859595e9da1b9543af09214f9d6d1137640d6ce",
		byteLength: 876,
	},
	rh_run_script: {
		sha256: "c2372b9d8b85ffec845ad37f16963606b64c74fcf748bc4e9591f0a79f116dc4",
		byteLength: 586,
	},
	rh_view_control: {
		sha256: "da7fedece7acb5bd631f073c2675530baf35a2155e35a662dadd5fe622aafd5c",
		byteLength: 2344,
	},
};
