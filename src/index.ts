/**
 * hoppercode CLI package entry.
 *
 * Agents talk to Rhino/Grasshopper through the `hopper` executable. This
 * module re-exports the CLI runner and operation registry; it is not a Pi
 * extension and does not start an MCP server.
 */
export { main, runCli } from "./cli/main.js";
export { createOperationRegistry, HOPPER_OPERATIONS } from "./operations/index.js";
