import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { HopperState } from "../state/hopper-types";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export function ConnectionBanner({ connection, reconnecting = false, onReconnect }: { connection: HopperState["connection"]; reconnecting?: boolean; onReconnect(): void }) {
	if (connection.status === "connected") return null;
	const lost = connection.status === "disconnected" || connection.status === "error";
	const headline = reconnecting ? "Reconnecting to the local Hopper host…" : connection.status === "error"
		? "Hopper can't reach the local host."
		: connection.status === "disconnected"
			? "Connection to the local Hopper host was lost."
			: connection.status === "authenticating"
				? "Confirming the Rhino session…"
				: "Connecting to the local Hopper host…";
	return (
		<div
			role="status"
			className={cn(
				"absolute inset-x-0 top-full z-30 flex items-center gap-3 border-b px-4 py-1.5 text-xs shadow-sm sm:px-6",
				lost && !reconnecting ? "border-danger/20 bg-danger-soft text-danger" : "border-warn/20 bg-warn-soft text-warn",
			)}
		>
			{lost && !reconnecting ? <WifiOff className="size-4 shrink-0" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
			<div className="min-w-0 flex-1">
				<span className="font-medium">{headline}</span>
				{!reconnecting && <span className="ml-1.5 opacity-80">{connection.detail}</span>}
			</div>
			{(lost || reconnecting) && (
				<Button size="xs" variant="secondary" onClick={onReconnect}>
					<RefreshCw className="size-3" />
					Reconnect
				</Button>
			)}
		</div>
	);
}
