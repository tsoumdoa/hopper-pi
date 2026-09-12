import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
	return <TooltipPrimitive.Provider delayDuration={350}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
	return <TooltipPrimitive.Root>
		<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content sideOffset={6} collisionPadding={8} className="z-[70] max-w-64 rounded-md bg-ink px-2 py-1 text-[11px] font-medium leading-4 text-canvas shadow-pop animate-fade-in">
				{content}
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	</TooltipPrimitive.Root>;
}
