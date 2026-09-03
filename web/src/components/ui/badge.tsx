import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
	return <span className={cn("inline-flex min-h-6 items-center border border-zinc-300 px-2 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-black", className)} {...props} />;
}
