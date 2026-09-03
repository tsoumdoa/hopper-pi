import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={cn("flex min-h-24 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-800/25 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />;
}
