import {
	collectToolSchemaMetrics,
	formatToolSchemaMetrics,
} from "../tools/tool-schema-metrics.js";

const report = collectToolSchemaMetrics();
process.stdout.write(`${formatToolSchemaMetrics(report)}\n`);
