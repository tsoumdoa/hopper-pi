import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
	return <SelectPrimitive.Trigger className={cn("flex h-10 w-full items-center justify-between rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-800/25 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown className="size-4 text-stone-500" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>;
}

export function SelectContent({ className, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
	return <SelectPrimitive.Portal><SelectPrimitive.Content className={cn("z-50 max-h-72 overflow-auto rounded-lg border border-stone-200 bg-white p-1 shadow-xl", className)} {...props}><SelectPrimitive.Viewport /></SelectPrimitive.Content></SelectPrimitive.Portal>;
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
	return <SelectPrimitive.Item className={cn("relative flex cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-emerald-50", className)} {...props}><span className="absolute left-2"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>;
}
