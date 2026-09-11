// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageMarkdown } from "./message-markdown";

let root: Root;
let container: HTMLDivElement;
const render = (text: string) => act(async () => root.render(createElement(MessageMarkdown, { text })));

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it("ignores raw HTML, filters unsafe URLs, and opens normal links separately", async () => {
	await render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n[docs](https://example.com "Docs")');
	expect(container.querySelector("script, img")).toBeNull();
	const links = container.querySelectorAll("a");
	expect(links[0].getAttribute("href")).toBe("");
	expect(links[1].getAttribute("href")).toBe("https://example.com");
	expect(links[1].target).toBe("_blank");
	expect(links[1].rel).toBe("noopener noreferrer");
	expect(links[1].title).toBe("Docs");
});
