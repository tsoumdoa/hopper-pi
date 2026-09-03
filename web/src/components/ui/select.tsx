import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
	return <SelectPrimitive.Trigger className={cn("flex h-8 w-full items-center justify-between rounded-[3px] border border-zinc-300 bg-white px-2.5 text-sm outline-none hover:border-black focus:ring-1 focus:ring-black disabled:cursor-not-allowed disabled:opacity-40", className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown className="size-3.5 text-black" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}

export function SelectContent({ className, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
	return <SelectPrimitive.Portal><SelectPrimitive.Content className={cn("z-50 max-h-72 overflow-auto border border-black bg-white p-1", className)} {...props}><SelectPrimitive.Viewport /></SelectPrimitive.Content></SelectPrimitive.Portal>;
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
	return <SelectPrimitive.Item className={cn("relative flex cursor-default select-none items-center py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-zinc-100", className)} {...props}><span className="absolute left-2"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>;
}
