import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function ScrollArea({ className, children, ...props }: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
	return <ScrollAreaPrimitive.Root className={cn("overflow-hidden", className)} {...props}><ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport><ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2.5 touch-none p-0.5"><ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-stone-300" /></ScrollAreaPrimitive.Scrollbar><ScrollAreaPrimitive.Corner /></ScrollAreaPrimitive.Root>;
}
