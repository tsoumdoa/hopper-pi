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

it("preserves table scroll position while more response text streams in", async () => {
	const text = "| Name | Value |\n| --- | --- |\n| x | 1 |";
	await render(text);
	const scroller = container.querySelector("table")!.parentElement!;
	scroller.scrollLeft = 100;
	await render(`${text}\n\nMore text`);
	expect(container.querySelector("table")!.parentElement).toBe(scroller);
	expect(scroller.scrollLeft).toBe(100);
});

it("navigates footnotes within their reply without changing the authentication URL", async () => {
	const text = "A claim[^1].\n\n[^1]: Supporting detail.";
	await act(async () => root.render(createElement("div", null,
		createElement(MessageMarkdown, { text }),
		createElement(MessageMarkdown, { text }),
	)));
	const ids = Array.from(container.querySelectorAll("[id]"), (node) => node.id);
	expect(new Set(ids).size).toBe(ids.length);
	const replies = container.querySelectorAll(".message-markdown");
	const url = window.location.href;
	for (const reply of replies) {
		const reference = reply.querySelector("a[data-footnote-ref]")!;
		expect(reply.contains(document.getElementById(reference.getAttribute("aria-describedby")!))).toBe(true);
		for (const link of reply.querySelectorAll<HTMLAnchorElement>("a")) {
			const target = document.getElementById(link.hash.slice(1))!;
			expect(reply.contains(target)).toBe(true);
			const scroll = vi.fn();
			target.scrollIntoView = scroll;
			for (const click of [
				new MouseEvent("click", { bubbles: true, cancelable: true }),
				new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
				new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
			]) {
				scroll.mockClear();
				await act(async () => { link.dispatchEvent(click); });
				expect(click.defaultPrevented).toBe(true);
				expect(scroll).toHaveBeenCalledOnce();
				expect(document.activeElement).toBe(target);
				expect(window.location.href).toBe(url);
			}
		}
	}
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
