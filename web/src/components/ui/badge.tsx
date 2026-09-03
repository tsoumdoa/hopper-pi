import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
	return <span className={cn("inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-950", className)} {...props} />;
}
