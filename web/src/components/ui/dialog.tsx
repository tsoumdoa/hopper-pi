import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({ className, children, hideClose, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] animate-fade-in" />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-pop outline-none animate-pop-in",
					className,
				)}
				{...props}
			>
				{children}
				{!hideClose && (
					<DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35" aria-label="Close">
						<X className="size-4" />
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-1.5 pr-8", className)} {...props} />;
}

export function DialogKicker({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn("text-[11px] font-semibold uppercase tracking-[.12em] text-accent", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("text-lg font-semibold tracking-tight text-ink", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-sm leading-relaxed text-ink-soft", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("flex flex-wrap items-center justify-end gap-2", className)} {...props} />;
}
