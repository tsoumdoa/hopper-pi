import type { Element, Root } from "hast";
import { memo, useId, type MouseEvent } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

// Footnote IDs and their accessibility references must be unique across replies.
function scopeMarkdownIds(prefix: string) {
	return (tree: Root) => {
		function walk(parent: Root | Element) {
			for (const node of parent.children) {
				if (node.type !== "element") continue;
				const props = node.properties;
				if (typeof props.id === "string") props.id = prefix + props.id;
				if (typeof props.href === "string" && props.href.startsWith("#")) props.href = `#${prefix}${props.href.slice(1)}`;
				if (Array.isArray(props.ariaDescribedBy)) props.ariaDescribedBy = props.ariaDescribedBy.map((id) => prefix + id);
				walk(node);
			}
		}
		walk(tree);
	};
}

function navigateFragment(event: MouseEvent<HTMLAnchorElement>) {
	const href = event.currentTarget.getAttribute("href");
	if (!href?.startsWith("#")) return;
	// The host uses the URL fragment for authentication, so leave it unchanged.
	event.preventDefault();
	const reply = event.currentTarget.closest(".message-markdown");
	const target = Array.from(reply?.querySelectorAll<HTMLElement>("[id]") ?? []).find((node) => node.id === href.slice(1));
	if (!target) return;
	target.tabIndex = -1;
	target.focus({ preventScroll: true });
	target.scrollIntoView({ block: "nearest" });
}

const components: Components = {
	a: ({ node: _node, href, ...props }) => <a {...props} href={href} target={href?.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer" onClick={navigateFragment} onAuxClick={navigateFragment} />,
	table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
};

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
	const id = useId();
	return (
		<div className="message-markdown">
			<Markdown remarkPlugins={remarkPlugins} rehypePlugins={[[scopeMarkdownIds, `${id}-`]]} skipHtml components={components}>{text}</Markdown>
		</div>
	);
});
