import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", {
	variants: {
		variant: {
			neutral: "border-line bg-surface text-ink-soft",
			accent: "border-accent/20 bg-accent-soft text-accent",
			warn: "border-warn/20 bg-warn-soft text-warn",
			danger: "border-danger/20 bg-danger-soft text-danger",
		},
	},
	defaultVariants: { variant: "neutral" },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean; pulse?: boolean };

export function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
	return (
		<span className={cn(badgeVariants({ variant }), className)} {...props}>
			{dot && <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse")} />}
			{children}
		</span>
	);
}
