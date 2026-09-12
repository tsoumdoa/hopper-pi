import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
	return <TooltipPrimitive.Provider delayDuration={350}>
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content sideOffset={6} className="z-[70] max-w-64 rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs text-ink shadow-pop backdrop-blur-md animate-fade-in">
					{content}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	</TooltipPrimitive.Provider>;
}
