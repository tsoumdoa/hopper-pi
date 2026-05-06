export interface Position {
	x: number;
	y: number;
}

export interface PortRef {
	componentId: string;
	port: string;
}

export interface AddComponentParams {
	guid: string;
	position: Position;
}

export interface DeleteComponentParams {
	targetId: string;
}

export interface ConnectWireParams {
	from: PortRef;
	to: PortRef;
}

export interface DisconnectWireParams {
	from: PortRef;
	to: PortRef;
}

export interface MoveComponentParams {
	targetId: string;
	position: Position;
}

export interface RenameComponentParams {
	targetId: string;
	nickName: string;
}

export interface SetComponentLockedParams {
	targetId: string;
	locked: boolean;
}

export interface SetComponentHiddenParams {
	targetId: string;
	hidden: boolean;
}

export interface AddGroupParams {
	componentIds: string[];
	groupName: string;
}

export interface RemoveFromGroupParams {
	componentIds: string[];
	groupName: string;
}

export interface SetSliderValueParams {
	targetId: string;
	value: number;
}

export interface SetPanelTextParams {
	targetId: string;
	text: string;
}

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

export interface Command {
	action: CommandAction;
	params: CommandParams;
}

export interface SubmitJobRequest {
	type: "submitJob";
	jobId: string;
	command: Command;
}

