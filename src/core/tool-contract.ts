import { Type, type Static, type TSchema } from "typebox";

export type HopperTextContent = { type: "text"; text: string };
export type HopperImageContent = { type: "image"; data: string; mimeType: string };
export type HopperContent = HopperTextContent | HopperImageContent;

export type HopperResult<TDetails = unknown> = {
	content: HopperContent[];
	details: TDetails;
	isError?: boolean;
};

export type HopperProgressUpdate<TDetails = unknown> = {
	content: HopperContent[];
	details: TDetails;
};

export type HopperCallContext = {
	toolCallId: string;
	signal?: AbortSignal;
	reportProgress?: (update: HopperProgressUpdate) => void;
	supportsImages?: boolean;
	captureAllowed?: boolean;
	/** Adapter-owned context. Core tools must not import its framework type. */
	hostContext?: unknown;
};

export type HopperToolAnnotations = {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
};

export interface HopperToolSpec<TInputSchema extends TSchema = TSchema, TDetails = unknown> {
	name: string;
	title: string;
	description: string;
	inputSchema: TInputSchema;
	outputSchema: TSchema;
	annotations: HopperToolAnnotations;
	promptSnippet?: string;
	promptGuidelines?: string[];
	prepareArguments?: (args: unknown) => Static<TInputSchema>;
	/** @deprecated Pi compatibility alias. Adapters should use title. */
	readonly label: string;
	/** @deprecated Pi compatibility alias. Adapters should use inputSchema. */
	readonly parameters: TInputSchema;
	execute(input: Static<TInputSchema>, ctx: HopperCallContext): Promise<HopperResult<TDetails>>;
	execute(
		toolCallId: string,
		params: Static<TInputSchema>,
		signal: AbortSignal | undefined,
		onUpdate: ((update: HopperProgressUpdate) => void) | undefined,
		ctx: any,
	): Promise<HopperResult<TDetails>>;
}

type LegacyExecute<TInputSchema extends TSchema> = (
	toolCallId: string,
	params: Static<TInputSchema>,
	signal: AbortSignal | undefined,
	onUpdate: ((update: HopperProgressUpdate) => void) | undefined,
	ctx: any,
) => Promise<HopperResult<any>>;

export type HopperToolDefinition<TInputSchema extends TSchema = TSchema> = {
	name: string;
	label: string;
	description: string;
	parameters: TInputSchema;
	promptSnippet?: string;
	promptGuidelines?: string[];
	annotations?: HopperToolAnnotations;
	outputSchema?: TSchema;
	prepareArguments?: (args: unknown) => Static<TInputSchema>;
	execute?: LegacyExecute<TInputSchema>;
	executeCore?: (
		input: Static<TInputSchema>,
		ctx: HopperCallContext,
	) => Promise<HopperResult<any>>;
};

const READ_ONLY_TOOLS = new Set([
	"rh_query_objects",
	"rh_capture_view",
	"gh_get_canvas",
	"gh_list_components",
	"gh_get_canvas_errors",
]);

function defaultAnnotations(name: string): HopperToolAnnotations {
	const readOnly = READ_ONLY_TOOLS.has(name);
	return {
		readOnlyHint: readOnly,
		destructiveHint: !readOnly,
		idempotentHint: readOnly,
		openWorldHint: true,
	};
}

/**
 * Defines a portable tool while accepting the former positional handler shape.
 * The compatibility input keeps this extraction behavior-neutral; adapters only
 * consume the returned HopperToolSpec.
 */
export function defineHopperTool<TInputSchema extends TSchema>(
	definition: HopperToolDefinition<TInputSchema>,
): HopperToolSpec<TInputSchema, any> {
	const execute = (...args: any[]) => {
		if (args.length === 2 && args[1] && typeof args[1] === "object" && "toolCallId" in args[1]) {
			const [input, ctx] = args as [Static<TInputSchema>, HopperCallContext];
			if (definition.executeCore) return definition.executeCore(input, ctx);
			if (definition.execute) {
				return definition.execute(ctx.toolCallId, input, ctx.signal, ctx.reportProgress, ctx.hostContext);
			}
		}
		if (definition.execute) return definition.execute(args[0], args[1], args[2], args[3], args[4]);
		throw new TypeError(`${definition.name} must be called with HopperCallContext`);
	};
	return {
		name: definition.name,
		title: definition.label,
		description: definition.description,
		inputSchema: definition.parameters,
		outputSchema: definition.outputSchema ?? Type.Object({}, { additionalProperties: true }),
		annotations: definition.annotations ?? defaultAnnotations(definition.name),
		promptSnippet: definition.promptSnippet,
		promptGuidelines: definition.promptGuidelines,
		prepareArguments: definition.prepareArguments,
		label: definition.label,
		parameters: definition.parameters,
		execute,
	};
}
