import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			className={cn(
				"flex min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed shadow-sm outline-none transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
