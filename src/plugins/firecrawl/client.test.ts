import { afterEach, describe, expect, it, vi } from "vitest";
import { FirecrawlClient, FIRECRAWL_LIMITS } from "./client.js";
import { canonicalPublicUrl } from "./url.js";
import { createFirecrawlPlugin } from "./index.js";

const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
function setup(fetcher = vi.fn(async () => response({ web: [{ title: "Docs", url: "https://example.com", description: "excerpt" }] }))) {
	const admit = vi.fn(async () => ({ apiKey: "sentinel-secret" }));
	return { fetcher, admit, client: new FirecrawlClient({ admit, fetch: fetcher as typeof fetch }) };
}
afterEach(() => vi.useRealTimers());

describe("Firecrawl URLs", () => {
	it.each(["http://localhost", "http://foo.local", "http://foo.localhost", "http://printer", "http://user:pass@example.com", "file:///tmp/a", "http://0", "http://2130706433", "http://0177.0.0.1", "http://0x7f000001", "http://10.1", "http://192.168.1.1", "http://100.64.0.1", "http://169.254.169.254", "http://[::1]", "http://[::]", "http://[::ffff:127.0.0.1]", "http://[::ffff:192.168.0.1]", "http://[fc00::1]", "http://[fe80::1]", "http://[ff00::1]", "http://[2001:db8::1]", "http://224.0.0.1", "http://240.1.2.3", "https://example.com/\nfoo"])("rejects %s", url => {
		expect(() => canonicalPublicUrl(url)).toThrow();
	});
	it.each(["https://example.com/path", "http://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://[::ffff:8.8.8.8]/"])("accepts public %s", url => expect(canonicalPublicUrl(url)).toMatch(/^https?:/));
	it("canonicalizes host and removes fragments", () => expect(canonicalPublicUrl("https://EXAMPLE.com:443/a#b")).toBe("https://example.com/a"));
});

describe("Firecrawl adapter", () => {
	it("does nothing at construction; uses web-only grouped search with one fresh admission per request", async () => {
		const { client, fetcher, admit } = setup();
		expect(admit).not.toHaveBeenCalled();
		expect(await client.search({ query: "docs", includeDomains: ["Example.com"] })).toContain("excerpt");
		expect(admit).toHaveBeenCalledTimes(1);
		const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(args[0]).toBe("https://api.firecrawl.dev/v2/search");
		expect(JSON.parse(args[1].body as string)).toEqual({ query: "docs", limit: 5, sources: ["web"], timeout: 30000, includeDomains: ["example.com"] });
		expect(args[1].redirect).toBe("error");
		await client.search({ query: "again", limit: 10 });
		expect(admit).toHaveBeenCalledTimes(2);
	});
	it("rejects invalid caps and domains before admission", async () => {
		const { client, admit } = setup();
		for (const params of [{ query: "a".repeat(2001) }, { query: "" }, { query: "x", limit: 11 }, { query: "x", limit: 0 }, { query: "x", limit: 1.1 }, { query: "x", includeDomains: ["https://example.com"] }, { query: "x", includeDomains: ["example.com"], excludeDomains: ["example.org"] }]) {
			await expect(client.search(params)).rejects.toMatchObject({ code: "invalid-input" });
		}
		await expect(client.scrape({ url: "https://example.com/" + "a".repeat(8192) })).rejects.toMatchObject({ code: "invalid-input" });
		expect(admit).not.toHaveBeenCalled();
	});
	it("requests Markdown only, caps output, closes cut code fences, and redacts provider echoes", async () => {
		const { client, fetcher } = setup(vi.fn(async () => response({ markdown: "sentinel-secret\n```ts\n" + "x".repeat(60000) })));
		const text = await client.scrape({ url: "https://example.com" });
		expect(text).toContain("Source: https://example.com/");
		expect(text).not.toContain("sentinel-secret");
		expect(text).toContain("truncated");
		expect(text.length).toBeLessThanOrEqual(50000);
		expect(text.match(/^```/gm)).toHaveLength(2);
		const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(args[1].body as string)).toEqual({ url: "https://example.com/", formats: ["markdown"], timeout: 60000 });
	});
	it.each([[401, "authentication"], [403, "authentication"], [402, "quota"], [429, "quota"], [408, "timeout"], [500, "unavailable"]])("sanitizes status %s and never retries", async (status, code) => {
		const { client, fetcher } = setup(vi.fn(async () => new Response("sentinel-secret", { status: status as number })));
		await expect(client.search({ query: "x" })).rejects.toMatchObject({ code });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("aborts a decoded stream above 2 MiB", async () => {
		const cancel = vi.fn();
		const { client } = setup(vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(FIRECRAWL_LIMITS.responseBytes + 1)); }, cancel }))));
		await expect(client.search({ query: "x" })).rejects.toMatchObject({ code: "response-size" });
		expect(cancel).toHaveBeenCalled();
	});
	it("caps search text and result count and reports truncation", async () => {
		const { client } = setup(vi.fn(async () => response({ web: Array.from({ length: 15 }, (_, i) => ({ title: `result-${i}`, url: `https://example.com/${i}`, description: "x".repeat(6000) })) })));
		const text = await client.search({ query: "x", limit: 10 });
		expect(text.length).toBeLessThanOrEqual(20000);
		expect(text).toContain("truncated");
		expect(text).not.toContain("result-10");
	});
	it.each([{}, { web: "wrong" }, { web: null }])("rejects a malformed grouped response", async data => {
		const { client } = setup(vi.fn(async () => response(data)));
		await expect(client.search({ query: "x" })).rejects.toMatchObject({ code: "response-invalid" });
	});
	it("skips malformed result rows without publishing unsafe URLs", async () => {
		const { client } = setup(vi.fn(async () => response({ web: [null, { url: "http://127.0.0.1" }, { url: "https://example.com" }] })));
		const text = await client.search({ query: "x" });
		expect(text).toContain("Untitled");
		expect(text).not.toContain("127.0.0.1");
	});
	it("uses a replacement key for each new admission and never sends a missing key", async () => {
		const fetcher = vi.fn(async () => response({ web: [] }));
		const admit = vi.fn().mockResolvedValueOnce({ apiKey: "old-key" }).mockResolvedValueOnce({ apiKey: "new-key" }).mockResolvedValueOnce({ apiKey: "" });
		const client = new FirecrawlClient({ fetch: fetcher as typeof fetch, admit });
		await client.search({ query: "x" });
		await client.search({ query: "x" });
		await expect(client.search({ query: "x" })).rejects.toMatchObject({ code: "missing-key" });
		const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
		expect(calls.map(([, options]) => (options.headers as Record<string, string>).Authorization)).toEqual(["Bearer old-key", "Bearer new-key"]);
	});
	it("the deadline also bounds a stalled response stream", async () => {
		vi.useFakeTimers();
		const { client } = setup(vi.fn(async () => new Response(new ReadableStream())));
		const pending = expect(client.scrape({ url: "https://example.com" })).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(60000);
		await pending;
	});
	it("bounds stalled admission and never dispatches after it times out", async () => {
		vi.useFakeTimers();
		let admit!: (value: { apiKey: string; release: () => void }) => void;
		const fetcher = vi.fn();
		const release = vi.fn();
		const client = new FirecrawlClient({ admit: () => new Promise(resolve => { admit = resolve; }), fetch: fetcher });
		const request = expect(client.search({ query: "x" })).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(30000);
		await request;
		admit({ apiKey: "key", release });
		await Promise.resolve();
		expect(fetcher).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledOnce();
	});
	it("child disable cancels its request while another tool remains admitted", async () => {
		const fetcher = vi.fn(async () => new Response(new ReadableStream()));
		const { client } = setup(fetcher);
		const search = expect(client.search({ query: "x" })).rejects.toMatchObject({ code: "cancelled" });
		client.abortTool("web_search");
		await search;
		const scrape = expect(client.scrape({ url: "https://example.com" })).rejects.toMatchObject({ code: "cancelled" });
		client.abortAll();
		await scrape;
	});
	it("does not treat a hostname as proof of the remote DNS or redirect destination", async () => {
		// The fake provider models a name that resolves privately or redirects remotely.
		// Hopper never resolves or locally requests it; stronger isolation is not claimed.
		const { client, fetcher } = setup(vi.fn(async () => response({ markdown: "provider content", metadata: { sourceURL: "http://10.0.0.1/" } })));
		await expect(client.scrape({ url: "https://public.example.com" })).resolves.toContain("provider content");
		expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("https://api.firecrawl.dev/v2/scrape");
	});
	it("tool results never include unknown provider or admission errors", async () => {
		const plugin = createFirecrawlPlugin({ admit: async () => { throw new Error("sentinel-secret"); } });
		const tool = plugin.tools[0];
		const result = await tool.execute("id", { query: "x" }, undefined, undefined, {} as never);
		expect(JSON.stringify(result)).not.toContain("sentinel-secret");
		expect(result.details).toEqual({ error: "unavailable" });
	});
});
