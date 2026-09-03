import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={cn("flex min-h-24 w-full rounded-[3px] border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:ring-1 focus:ring-black disabled:cursor-not-allowed disabled:opacity-40", className)} {...props} />;
}
