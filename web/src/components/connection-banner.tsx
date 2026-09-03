import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { HopperState } from "../state/hopper-types";
import { Button } from "./ui/button";

export function ConnectionBanner({ connection, onReconnect }: { connection: HopperState["connection"]; onReconnect(): void }) {
	if (connection.status === "connected") return null;
	const lost = connection.status === "disconnected" || connection.status === "error";
	const headline = connection.status === "error"
		? "Hopper can't reach the local host."
		: connection.status === "disconnected"
			? "Connection to the local Hopper host was lost."
			: connection.status === "authenticating"
				? "Confirming the Rhino session…"
				: "Connecting to the local Hopper host…";
	return (
		<div
			role="status"
			className={
				lost
					? "flex items-center gap-3 border-b border-danger/20 bg-danger-soft px-4 py-2 text-xs text-danger sm:px-6 lg:px-10"
					: "flex items-center gap-3 border-b border-warn/20 bg-warn-soft px-4 py-2 text-xs text-warn sm:px-6 lg:px-10"
			}
		>
			{lost ? <WifiOff className="size-4 shrink-0" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
			<div className="min-w-0 flex-1">
				<span className="font-medium">{headline}</span>
				<span className="ml-1.5 opacity-80">{connection.detail}</span>
			</div>
			{lost && (
				<Button size="xs" variant="secondary" onClick={onReconnect}>
					<RefreshCw className="size-3" />
					Reconnect
				</Button>
			)}
		</div>
	);
}
