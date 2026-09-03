import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
	return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" /><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 border border-black bg-white p-6 focus:outline-none", className)} {...props} /></DialogPrimitive.Portal>;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className="text-xl font-medium tracking-tight" {...props} />;
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className="mt-2 text-[13px] text-zinc-600" {...props} />;
}
