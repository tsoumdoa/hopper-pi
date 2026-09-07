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

it("renders reply formatting, GFM tables, and code with indentation intact", async () => {
	await render('# Result\n\n**Done** with `x`.\n\n- First\n- Second\n\n| Name | Value |\n| --- | --- |\n| x | 1 |\n\n```python\nif True:\n    print("hello")\n```');
	expect(container.querySelector("h1")?.textContent).toBe("Result");
	expect(container.querySelector("strong")?.textContent).toBe("Done");
	expect(container.querySelectorAll("li")).toHaveLength(2);
	expect(container.querySelector("table")?.parentElement?.className).toBe("overflow-x-auto");
	expect(container.querySelector("td")?.textContent).toBe("x");
	expect(container.querySelector("pre code")?.textContent).toBe('if True:\n    print("hello")\n');
});

it("updates incomplete streaming Markdown as closing delimiters arrive", async () => {
	await render("**Building");
	expect(container.textContent).toContain("Building");
	await render("**Building complete**\n\n```python\nprint(");
	expect(container.querySelector("strong")?.textContent).toBe("Building complete");
	expect(container.querySelector("pre code")?.textContent).toBe("print(\n");
	await render('**Building complete**\n\n```python\nprint("done")\n```');
	expect(container.querySelectorAll("pre")).toHaveLength(1);
	expect(container.querySelector("pre code")?.textContent).toBe('print("done")\n');
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
