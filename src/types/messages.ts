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
	selectedInstanceGuids?: string[];
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

export type PingResponse = {
	type: "ping.response";
	timestamp: number;
};

export type GetCanvasErrorsResponse = {
	type: "getCanvasErrors.response";
	timestamp: number;
	docName: string;
	errors: CanvasError[];
};

export type RunRhinoScriptResponse = {
	type: "runRhinoScript.response";
	timestamp: number;
	ok: boolean;
	output: string;
	error: string;
};

export type RhinoObjectInfo = {
	objectId: string;
	name: string;
	layer: string;
	objectType: string;
};

export type QueryRhinoObjectsResponse = {
	type: "queryRhinoObjects.response";
	timestamp: number;
	objects: RhinoObjectInfo[];
};

export type ParamRhinoGeometryItem = {
	path: string;
	gooType: string;
	rhinoObjectId: string;
	source: string;
};

export type GetParamRhinoGeometryResponse = {
	type: "getParamRhinoGeometry.response";
	timestamp: number;
	targetId: string;
	paramName: string;
	volatileItems: ParamRhinoGeometryItem[];
	persistentItems: ParamRhinoGeometryItem[];
};
