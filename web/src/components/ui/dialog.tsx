import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
	return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-950/35 backdrop-blur-sm" /><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100%-28px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-stone-300 bg-[#fffdf8] p-6 shadow-2xl focus:outline-none", className)} {...props} /></DialogPrimitive.Portal>;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className="text-2xl font-bold tracking-tight" {...props} />;
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className="mt-2 text-sm text-stone-600" {...props} />;
}
