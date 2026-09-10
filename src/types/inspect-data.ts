export interface InspectDataResponse {
	type: "getData.response";
	targetId: string;
	mode: "summary" | "branches" | "items";
	solutionState: string;
	phase: string;
	locked: boolean;
	solverEnabled: boolean;
	totalRows: number;
	offset: number;
	returnedRows: number;
	hasMore: boolean;
	nextCursor: string | null;
	branchIndex?: number;
	path?: string;
	pathTruncated?: boolean;
	rows: Array<InspectPort | InspectBranch | InspectItem>;
}

interface InspectPort {
	portId: string;
	name: string;
	side: "input" | "output" | "parameter";
	index: number;
	dataType: string;
	access: string;
	phase: string;
	totalBranches: number;
	totalItems: number;
	truncated: boolean;
}

interface InspectBranch {
	branchIndex: number;
	path: string;
	totalItems: number;
	truncated: boolean;
}

interface InspectItem {
	index: number;
	type: string;
	wrappedType?: string;
	valid?: boolean;
	invalidReason?: string;
	value?: unknown;
	summary?: boolean;
	omitted?: string;
	truncated?: boolean;
	error?: string;
}
