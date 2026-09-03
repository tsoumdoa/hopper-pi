import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"flex h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-sm outline-none transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
