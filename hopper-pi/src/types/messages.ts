export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type GhJobStatus = {
	type: "gh.job.status";
	timestamp: number;
	jobId: string;
	commandId: string;
	state: JobState;
	progress: number;
	error: string | null;
};

export type GhEventXml = {
	type: "gh.event.xml";
	timestamp: number;
	docName: string;
	xml: string;
};

export type GhMessage = GhJobStatus | GhEventXml;

export type GhComponentInfo = {
	name: string;
	typeGuid: string;
	pluginName: string;
	assemblyName: string;
	category: string;
	subcategory: string;
	description: string;
};

export type ListAllComponentsResponse = {
	type: "listAllComponents.response";
	timestamp: number;
	components: GhComponentInfo[];
};

export type GetCurrentCanvasResponse = {
	type: "getCurrentCanvas.response";
	timestamp: number;
	docName: string;
	xml: string;
};

export type CanvasError = {
	componentId: string;
	componentNickName: string;
	level: "error" | "warning" | "message" | "unknown";
	text: string;
};

export type ScriptParamInfo = {
	name: string;
	access: string;
	dataMapping: string;
	simplify: boolean;
	reverse: boolean;
	typeHint: string;
};

export type ListScriptParamsResponse = {
	type: "listScriptParams.response";
	timestamp: number;
	inputs: ScriptParamInfo[];
	outputs: ScriptParamInfo[];
};

export type GetScriptCodeResponse = {
	type: "getScriptCode.response";
	timestamp: number;
	code: string;
};

export type GetCanvasErrorsResponse = {
	type: "getCanvasErrors.response";
	timestamp: number;
	docName: string;
	errors: CanvasError[];
};
