import { expect, test, vi } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";

const request = vi.hoisted(() => vi.fn());
vi.mock("../infra/request-helpers.js", () => ({
	withRequester: (fn: (req: { request: typeof request }) => unknown) => fn({ request }),
}));

import { ghInspectDataTool } from "./gh-inspect-data.js";
import { toShortInstanceGuid } from "../services/guid-shortener.js";

test("inspection resolves IDs, returns one page without document metadata, and continues only when asked", async () => {
	const id = "11111111-1111-1111-1111-111111111111";
	const page = { mode: "summary", rows: [], hasMore: true, nextCursor: "cursor-value" };
	request.mockResolvedValue({ ...page, settings: { name: "x".repeat(10000) }, transaction: { state: "active" } });
	const result = await ghInspectDataTool.execute("first", { targetId: toShortInstanceGuid(id) }, undefined, undefined, {} as never);
	expect(request).toHaveBeenCalledExactlyOnceWith({ type: "getData", targetId: id });
	expect(result.content).toEqual([{ type: "text", text: JSON.stringify(page) }]);
	expect(result.details).toEqual({});
	await ghInspectDataTool.execute("next", { cursor: "cursor-value", limit: 2 }, undefined, undefined, {} as never);
	expect(request).toHaveBeenCalledTimes(2);
	expect(request).toHaveBeenLastCalledWith({ type: "getData", cursor: "cursor-value", limit: 2 });
});

function validate(arguments_: Record<string, unknown>) {
	return validateToolArguments(ghInspectDataTool, {
		type: "toolCall", id: "schema", name: ghInspectDataTool.name, arguments: arguments_,
	});
}

test("items requires branchIndex and rejects path selection", () => {
	const params = { targetId: "port", mode: "items" };
	expect(() => validate(params)).toThrow();
	expect(() => validate({ ...params, branchIndex: 0 })).not.toThrow();
	expect(() => validate({ ...params, path: "{0;2}" })).toThrow();
	expect(() => validate({ ...params, branchIndex: 0, path: "{0;2}" })).toThrow();
	expect(() => validate({ targetId: "port", branchIndex: 0 })).toThrow();
	expect(() => validate({ ...params, branchIndex: 2147483648 })).toThrow();
});

test("cursor accepts an optional limit but excludes new inspection inputs", () => {
	expect(() => validate({ cursor: "next-page" })).not.toThrow();
	expect(() => validate({ cursor: "next-page", limit: 2 })).not.toThrow();
	expect(() => validate({ cursor: "next-page", targetId: "port" })).toThrow();
});
