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
	guid: string;
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
};

export type RemoveFromGroupParams = {
	componentIds: string[];
	groupName: string;
};

export type SetSliderValueParams = {
	targetId: string;
	value: number;
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
