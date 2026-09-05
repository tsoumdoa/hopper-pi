export type Position = {
	x: number;
	y: number;
};

export type PortRef = {
	componentId: string;
	port: string;
};

export type AddComponentParams = {
	typeGuid: string;
	position: Position;
	preview?: boolean;
};

export type DeleteComponentParams = {
	targetId: string;
};

export type ConnectWireParams = {
	from: PortRef;
	to: PortRef;
};

export type DisconnectWireParams = {
	from: PortRef;
	to: PortRef;
};

export type MoveComponentParams = {
	targetId: string;
	position: Position;
};

export type RenameComponentParams = {
	targetId: string;
	nickName: string;
};

export type SetComponentLockedParams = {
	targetId: string;
	locked: boolean;
};

export type SetComponentHiddenParams = {
	targetId: string;
	hidden: boolean;
};

export type AddGroupParams = {
	componentIds: string[];
	groupName: string;
	color?: string;
	border?: "Box" | "Blob" | "Rectangles";
};

export type RemoveFromGroupParams = {
	componentIds: string[];
	groupName: string;
};

export type DeleteGroupParams = {
	groupName: string;
};

export type ChangeGroupColorParams = {
	groupName: string;
	color?: string;
};

export type RenameGroupParams = {
	groupName: string;
	name: string;
};

export type ChangeGroupStyleParams = {
	groupName: string;
	color?: string;
	name?: string;
	border?: "Box" | "Blob" | "Rectangles";
};

export type SetSliderValueParams = {
	targetId: string;
	value: number;
};

export type CreateSliderParams = {
	position: Position;
	nickName?: string;
	min: number;
	max: number;
	value: number;
	digits: number;
};

export type EditSliderRangeParams = {
	targetId: string;
	min: number;
	max: number;
	digits: number;
};

export type SetPanelTextParams = {
	targetId: string;
	text: string;
};

export type CreateToggleParams = {
	position: Position;
	nickName?: string;
	value: boolean;
};

export type SetToggleValueParams = {
	targetId: string;
	value: boolean;
};

export type CreateSwatchParams = {
	position: Position;
	nickName?: string;
	color: string;
};

export type SetSwatchColorParams = {
	targetId: string;
	color: string;
};

export type CreateScribbleParams = {
	position: Position;
	nickName?: string;
	text: string;
	size?: number;
};

export type SetScribbleTextParams = {
	targetId: string;
	text: string;
};

export type CreateValueListItem = {
	name: string;
	value: string;
};

export type CreateValueListParams = {
	position: Position;
	nickName?: string;
	items: CreateValueListItem[];
	selectedIndex?: number;
};

export type SetValueListSelectedParams = {
	targetId: string;
	selectedIndex: number;
};

export type PanelTextOutput = "singleString" | "oneItemPerLine";

export type CreatePanelParams = {
	position: Position;
	nickName?: string;
	text: string;
	textOutput: PanelTextOutput;
	width?: number;
	height?: number;
	bgColor?: string;
};

export type SetPanelParams = {
	targetId: string;
	textOutput: PanelTextOutput;
	width?: number;
	height?: number;
	bgColor?: string;
};

export type TypeHint = "object" | "double" | "int" | "integer" | "string" | "bool" | "boolean";

export type ScriptIOParam = {
	name: string;
	previousName?: string;
	access?: string;
	dataMapping?: string;
	simplify?: boolean;
	reverse?: boolean;
	typeHint?: TypeHint;
};

export type CreateScriptNodeParams = {
	position: Position;
	language: "python" | "csharp";
	code: string;
	nickName?: string;
	inputs?: ScriptIOParam[];
	outputs?: ScriptIOParam[];
};

export type SetScriptCodeParams = {
	targetId: string;
	code: string;
	inputs?: ScriptIOParam[];
	outputs?: ScriptIOParam[];
};

export type SyncScriptParamsParams = {
	targetId: string;
	inputs?: ScriptIOParam[];
	outputs?: ScriptIOParam[];
};

export type GetScriptCodeParams = {
	targetId: string;
};

export type AddScriptInputParams = {
	targetId: string;
	name: string;
	access?: string;
	dataMapping?: string;
	simplify?: boolean;
	reverse?: boolean;
	typeHint?: TypeHint;
};

export type RemoveScriptInputParams = {
	targetId: string;
	name: string;
};

export type AddScriptOutputParams = {
	targetId: string;
	name: string;
	dataMapping?: string;
	simplify?: boolean;
	reverse?: boolean;
	typeHint?: TypeHint;
};

export type RemoveScriptOutputParams = {
	targetId: string;
	name: string;
};

export type ListScriptParamsParams = {
	targetId: string;
};

export type EditParamPropsParams = {
	targetId: string;
	name: string;
	access?: "item" | "list" | "tree";
	typeHint?: TypeHint;
	dataMapping?: "none" | "flatten" | "graft";
	simplify?: boolean;
	reverse?: boolean;
};

export type BeginAgentTransactionParams = {
	name?: string;
};

export type EmptyParams = Record<string, never>;

export type RhinoObjectQueryParams = {
	selectionOnly?: boolean;
	layer?: string;
	objectType?: string;
};

export type SetParamRhinoGeometryParams = {
	targetId: string;
	mode: "reference" | "internalize";
	rhinoObjectIds?: string[];
	rhinoQuery?: RhinoObjectQueryParams;
};

export type CommandMap = {
	addComponent: AddComponentParams;
	deleteComponent: DeleteComponentParams;
	connectWire: ConnectWireParams;
	disconnectWire: DisconnectWireParams;
	moveComponent: MoveComponentParams;
	renameComponent: RenameComponentParams;
	setComponentLocked: SetComponentLockedParams;
	setComponentHidden: SetComponentHiddenParams;
	addGroup: AddGroupParams;
	removeFromGroup: RemoveFromGroupParams;
	deleteGroup: DeleteGroupParams;
	changeGroupColor: ChangeGroupColorParams;
	renameGroup: RenameGroupParams;
	changeGroupStyle: ChangeGroupStyleParams;
	createSlider: CreateSliderParams;
	editSliderRange: EditSliderRangeParams;
	setSliderValue: SetSliderValueParams;
	createPanel: CreatePanelParams;
	setPanelParams: SetPanelParams;
	setPanelText: SetPanelTextParams;
	createToggle: CreateToggleParams;
	setToggleValue: SetToggleValueParams;
	createSwatch: CreateSwatchParams;
	setSwatchColor: SetSwatchColorParams;
	createScribble: CreateScribbleParams;
	setScribbleText: SetScribbleTextParams;
	createValueList: CreateValueListParams;
	setValueListSelected: SetValueListSelectedParams;
	createScriptNode: CreateScriptNodeParams;
	setScriptCode: SetScriptCodeParams;
	syncScriptParams: SyncScriptParamsParams;
	getScriptCode: GetScriptCodeParams;
	addScriptInput: AddScriptInputParams;
	removeScriptInput: RemoveScriptInputParams;
	addScriptOutput: AddScriptOutputParams;
	removeScriptOutput: RemoveScriptOutputParams;
	listScriptParams: ListScriptParamsParams;
	editParamProps: EditParamPropsParams;
	beginAgentTransaction: BeginAgentTransactionParams;
	commitAgentTransaction: EmptyParams;
	cancelAgentTransaction: EmptyParams;
	beginRhinoAgentTransaction: BeginAgentTransactionParams;
	commitRhinoAgentTransaction: EmptyParams;
	cancelRhinoAgentTransaction: EmptyParams;
	setParamRhinoGeometry: SetParamRhinoGeometryParams;
};

export type CommandAction = keyof CommandMap;

/** Runtime list of all command actions; keep in sync with CommandMap and C# CommandActionRegistry. */
export const COMMAND_ACTIONS = [
	"addComponent",
	"deleteComponent",
	"connectWire",
	"disconnectWire",
	"moveComponent",
	"renameComponent",
	"setComponentLocked",
	"setComponentHidden",
	"addGroup",
	"removeFromGroup",
	"deleteGroup",
	"changeGroupColor",
	"renameGroup",
	"changeGroupStyle",
	"createSlider",
	"editSliderRange",
	"setSliderValue",
	"createPanel",
	"setPanelParams",
	"setPanelText",
	"createToggle",
	"setToggleValue",
	"createSwatch",
	"setSwatchColor",
	"createScribble",
	"setScribbleText",
	"createValueList",
	"setValueListSelected",
	"createScriptNode",
	"setScriptCode",
	"syncScriptParams",
	"getScriptCode",
	"addScriptInput",
	"removeScriptInput",
	"addScriptOutput",
	"removeScriptOutput",
	"listScriptParams",
	"editParamProps",
	"beginAgentTransaction",
	"commitAgentTransaction",
	"cancelAgentTransaction",
	"beginRhinoAgentTransaction",
	"commitRhinoAgentTransaction",
	"cancelRhinoAgentTransaction",
	"setParamRhinoGeometry",
] as const satisfies readonly CommandAction[];
