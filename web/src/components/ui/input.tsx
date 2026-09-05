import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"flex h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-[13px] outline-none transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
