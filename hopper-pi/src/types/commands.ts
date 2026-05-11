export type Position = {
	x: number;
	y: number;
};

export type PortRef = {
	componentId: string;
	port: string;
};

export type ActionParamDef = {
	name: string;
	cliFlag: string;
	cliDescription: string;
	prompt: string;
	parse?: (v: string) => string | number | boolean | string[];
};

export type ActionDef = {
	id: number;
	action: CommandAction;
	label: string;
	params: ActionParamDef[];
};

export type AddComponentParams = {
	typeGuid: string;
	position: Position;
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
	interval: number;
};

export type EditSliderRangeParams = {
	targetId: string;
	min: number;
	max: number;
	digits: number;
	interval: number;
};

export type SetPanelTextParams = {
	targetId: string;
	text: string;
};

export type CommandAction =
	| "addComponent"
	| "deleteComponent"
	| "connectWire"
	| "disconnectWire"
	| "moveComponent"
	| "renameComponent"
	| "setComponentLocked"
	| "setComponentHidden"
	| "addGroup"
	| "removeFromGroup"
	| "deleteGroup"
	| "changeGroupColor"
	| "renameGroup"
	| "changeGroupStyle"
	| "createSlider"
	| "editSliderRange"
	| "setSliderValue"
	| "setPanelText";

export type CommandParams =
	| AddComponentParams
	| DeleteComponentParams
	| ConnectWireParams
	| DisconnectWireParams
	| MoveComponentParams
	| RenameComponentParams
	| SetComponentLockedParams
	| SetComponentHiddenParams
	| AddGroupParams
	| RemoveFromGroupParams
	| DeleteGroupParams
	| ChangeGroupColorParams
	| RenameGroupParams
	| ChangeGroupStyleParams
	| CreateSliderParams
	| EditSliderRangeParams
	| SetSliderValueParams
	| SetPanelTextParams;

export type Command = {
	action: CommandAction;
	params: CommandParams;
};

export type SubmitJobRequest = {
	type: "submitJob";
	jobId: string;
	command: Command;
};
