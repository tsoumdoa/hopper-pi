import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-accent text-white shadow-sm hover:bg-accent-hover",
				secondary: "border border-line bg-surface text-ink shadow-sm hover:border-line-strong hover:bg-surface-muted",
				ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
				destructive: "border border-line bg-surface text-danger shadow-sm hover:border-danger/40 hover:bg-danger-soft",
				link: "h-auto p-0 text-accent underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-3.5 text-sm",
				sm: "h-8 px-3 text-[13px]",
				xs: "h-7 px-2.5 text-xs",
				lg: "h-10 px-4 text-sm",
				icon: "size-9",
				"icon-sm": "size-8",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type = "button", ...props }: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : type} {...props} />;
}
