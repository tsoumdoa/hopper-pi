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

export type DocumentTarget = {
	backendInstanceId: string;
	ghDocument: { path: string | null; runtimeId: string } | null;
	rhinoDocument: { name: string; runtimeSerialNumber: number } | null;
};

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
	target?: DocumentTarget;
};

export type GetCurrentCanvasResponse = {
	type: "getCurrentCanvas.response";
	timestamp: number;
	docName: string;
	xml: string;
	selectedInstanceGuids?: string[];
	target?: DocumentTarget;
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
	target?: DocumentTarget;
};

export type PingResponse = {
	type: "ping.response";
	timestamp: number;
	backendStartedAt?: number;
	target?: DocumentTarget;
};

export type AuthErrorResponse = {
	type: "auth.error";
	timestamp: number;
	error: string;
};

export type RunRhinoScriptResponse = {
	type: "runRhinoScript.response";
	timestamp: number;
	ok: boolean;
	output: string;
	error: string;
	target?: DocumentTarget;
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
	target?: DocumentTarget;
};

export type RhinoPoint3d = {
	x: number;
	y: number;
	z: number;
};

export type RhinoViewMetadata = {
	viewName: string;
	viewportId: string;
	projection: string;
	cameraLocation: RhinoPoint3d;
	cameraTarget: RhinoPoint3d;
	cameraDirection: RhinoPoint3d;
	cameraUp: RhinoPoint3d;
	lensLength: number;
	cplaneName: string;
	cplaneOrigin: RhinoPoint3d;
	width?: number;
	height?: number;
};

export type CaptureRhinoViewResponse = {
	type: "captureRhinoView.response";
	timestamp: number;
	ok: boolean;
	imageBase64: string;
	mediaType: "image/png";
	error?: string | null;
	metadata?: RhinoViewMetadata | null;
};

export type ControlRhinoViewResponse = {
	type: "controlRhinoView.response";
	timestamp: number;
	ok: boolean;
	error?: string | null;
	message: string;
	metadata?: RhinoViewMetadata | null;
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
