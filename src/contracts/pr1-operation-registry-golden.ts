import type { MutationScope } from "../core/contracts.js";

export type Pr1OperationName =
	| "gh_apply_graph"
	| "gh_create_widget"
	| "gh_edit_components"
	| "gh_edit_group"
	| "gh_edit_param"
	| "gh_edit_script"
	| "gh_edit_wire"
	| "gh_get_canvas"
	| "gh_get_canvas_errors"
	| "gh_list_components"
	| "gh_mutate_widget"
	| "gh_param_rhino"
	| "rh_capture_view"
	| "rh_query_objects"
	| "rh_run_script"
	| "rh_view_control";

type RegistryGolden = {
	description: string;
	group: "rhino" | "gh-read" | "gh-edit" | "gh-script";
	possibleScopes: readonly MutationScope[];
	batchable: boolean;
	outputSchema: { sha256: string; byteLength: number };
};

export const PR1_OPERATION_REGISTRY_GOLDEN: Record<Pr1OperationName, RegistryGolden> = {
	gh_apply_graph: {
		description: "Atomically create a new Grasshopper subgraph with local refs, validation, and one backend transaction.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "33675321ccc6ad99748d4ad7b569111139380b80c7b855a170da504318ed35f8", byteLength: 1695 },
	},
	gh_create_widget: {
		description: "Create Grasshopper UI widgets.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_edit_components: {
		description: "Add, delete, move, rename, lock, or hide Grasshopper canvas objects.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_edit_group: {
		description: "Create and edit Grasshopper groups.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_edit_param: {
		description: "Inspect or edit ports on Grasshopper C# and Python script components.",
		group: "gh-script", possibleScopes: ["none", "grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_edit_script: {
		description: "Create, inspect, replace, or patch Grasshopper C# and Python script components.",
		group: "gh-script", possibleScopes: ["none", "grasshopper"], batchable: true,
		outputSchema: { sha256: "e531b3f07270abc715877ef945176c15c6f53fb11dfaa2675867443709f653bc", byteLength: 715 },
	},
	gh_edit_wire: {
		description: "Connect or disconnect Grasshopper wires.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_get_canvas: {
		description: "Fetch the live Grasshopper canvas as structured data.",
		group: "gh-read", possibleScopes: ["none"], batchable: false,
		outputSchema: { sha256: "6f4f2dcf02682735bcf21f930401a04f63a6eadac1588b72a1f70deae8f7a3d9", byteLength: 367 },
	},
	gh_get_canvas_errors: {
		description: "Return Grasshopper runtime messages and canvas overlap checks.",
		group: "gh-read", possibleScopes: ["none"], batchable: false,
		outputSchema: { sha256: "d38de3ad50411475bf993098c00ea4f3bbdb0565d64848462c973ddd82dac47f", byteLength: 262 },
	},
	gh_list_components: {
		description: "Search the Grasshopper component registry and return structured component records.",
		group: "gh-read", possibleScopes: ["none"], batchable: false,
		outputSchema: { sha256: "30dbbd0f6f50346d707671ab6204e6e24d2108ecdf0db89f410074b1bedbe7e8", byteLength: 517 },
	},
	gh_mutate_widget: {
		description: "Change Grasshopper widget values and properties.",
		group: "gh-edit", possibleScopes: ["grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	gh_param_rhino: {
		description: "Get, reference, or internalize Rhino geometry on a Grasshopper geometry parameter.",
		group: "gh-edit", possibleScopes: ["none", "grasshopper"], batchable: true,
		outputSchema: { sha256: "eaac9b3e36da58eae62c6eddd36243247c3b95d2ad25e04ff63a9ee7edb8eaaf", byteLength: 733 },
	},
	rh_capture_view: {
		description: "Capture a permission-gated Rhino viewport image as an artifact.",
		group: "rhino", possibleScopes: ["none"], batchable: false,
		outputSchema: { sha256: "06f780c01dc3c1cf73bcb23e91e5e19c37d380da47f5c9334ed28b2845cfc22e", byteLength: 2045 },
	},
	rh_query_objects: {
		description: "List or count Rhino document objects using selection, layer, type, and ID filters.",
		group: "rhino", possibleScopes: ["none"], batchable: false,
		outputSchema: { sha256: "4b9f2d6e6a17cadfe4bcf47c6c1dbb1135f137a17b4f786f74b00b303bf5ac06", byteLength: 333 },
	},
	rh_run_script: {
		description: "Run Rhino command macros or Python/C# scripts against the active Rhino document.",
		group: "rhino", possibleScopes: ["rhino"], batchable: false,
		outputSchema: { sha256: "f0b7d61fa59f9ea4d2759cc88f2b1adf80751c9fd9ece1481cd2667231378a6b", byteLength: 623 },
	},
	rh_view_control: {
		description: "Change the active Rhino viewport, projection, camera, construction plane, or zoom.",
		group: "rhino", possibleScopes: ["viewport"], batchable: false,
		outputSchema: { sha256: "49d52eb1a4d2b8e9da42f866cc8f06358bc2ea7159993f0e82716b146a6759c6", byteLength: 1655 },
	},
};
