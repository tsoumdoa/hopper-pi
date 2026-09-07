import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
	return (
		<div className="message-markdown">
			<Markdown remarkPlugins={remarkPlugins} skipHtml components={{
				a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
				table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
			}}>{text}</Markdown>
		</div>
	);
});
