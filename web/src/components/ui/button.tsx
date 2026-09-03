import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-800/35 disabled:pointer-events-none disabled:opacity-45", {
	variants: {
		variant: {
			default: "bg-emerald-950 text-white hover:bg-emerald-900",
			secondary: "border border-stone-300 bg-white text-stone-900 hover:border-emerald-900",
			ghost: "text-stone-600 hover:bg-stone-200 hover:text-stone-950",
			destructive: "border border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
		},
		size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "size-9" },
	},
	defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
