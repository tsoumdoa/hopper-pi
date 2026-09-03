import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-[3px] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/25 disabled:pointer-events-none disabled:opacity-40", {
	variants: {
		variant: {
			default: "border-black bg-black text-white hover:bg-white hover:text-black",
			secondary: "border-zinc-300 bg-white text-black hover:border-black hover:bg-black hover:text-white",
			ghost: "border-transparent bg-transparent text-black hover:border-zinc-300",
			destructive: "border-zinc-300 bg-white text-red-600 hover:border-red-600 hover:bg-red-600 hover:text-white",
		},
		size: { default: "h-8 px-3", sm: "h-7 px-3 text-xs", icon: "size-8" },
	},
	defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
	const Comp = asChild ? Slot : "button";
	return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
