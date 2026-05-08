export type XmlItem = {
	name?: string;
	type_name?: string;
	type_code?: string;
	"#text"?: string | number | boolean;
	[key: string]: unknown;
};

export type XmlChunk = {
	name?: string;
	index?: string;
	items?: {
		item?: XmlItem[];
		count?: string;
	};
	chunks?: {
		chunk?: XmlChunk[];
		count?: string;
	};
};

export type ParsedXml = {
	Archive?: {
		name?: string;
		items?: {
			item?: XmlItem[];
			count?: string;
		};
		chunks?: {
			chunk?: XmlChunk[];
			count?: string;
		};
	};
};

export type ParsedComponent = {
	component: import("./gh.js").Component;
	guid: string;
	objectChunk: XmlChunk;
};
