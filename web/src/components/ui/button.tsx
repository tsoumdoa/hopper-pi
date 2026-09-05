import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-accent text-white hover:bg-accent-hover",
				secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted",
				ghost: "text-ink-soft hover:bg-ink/[.06] hover:text-ink",
				destructive: "border border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft",
				link: "h-auto p-0 text-accent underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 px-3 text-[13px]",
				sm: "h-7 px-2.5 text-xs",
				xs: "h-6 px-2 text-[11px]",
				lg: "h-9 px-3.5 text-sm",
				icon: "size-8",
				"icon-sm": "size-7",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
	return <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props} />;
}
