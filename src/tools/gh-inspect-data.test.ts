import { expect, test, vi } from "vitest";

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
