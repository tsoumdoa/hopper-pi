import { Download, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useHopperStoreApi } from "../state/hopper-store-context";
import { Button } from "./ui/button";

export function ExportSessionButton({ token, disabled, conversationId }: { token: string; disabled: boolean; conversationId?: string }) {
	const store = useHopperStoreApi();
	const pending = useRef(false);
	const [exporting, setExporting] = useState(false);

	const download = async () => {
		if (disabled || pending.current) return;
		pending.current = true;
		setExporting(true);
		try {
			const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
			const response = await fetch(`/api/session/export${query}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!response.ok) throw new Error(`Export failed (${response.status}).`);
			const url = URL.createObjectURL(await response.blob());
			try {
				const link = document.createElement("a");
				link.href = url;
				link.download = "hopper-session-debug.json";
				document.body.append(link);
				try { link.click(); } finally { link.remove(); }
			} finally {
				setTimeout(() => URL.revokeObjectURL(url), 10_000);
			}
		} catch (error) {
			store.getState().actions.toast(error instanceof Error ? error.message : "Could not export the session.", "error");
		} finally {
			pending.current = false;
			setExporting(false);
		}
	};

	return (
		<Button size="sm" variant="ghost" disabled={disabled || exporting} onClick={() => void download()}
			aria-label={exporting ? "Exporting session" : "Export session"} aria-busy={exporting}
			title="Download the current session, including tool calls and results, as JSON">
			{exporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
			<span className="max-sm:hidden">{exporting ? "Exporting…" : "Export session"}</span>
		</Button>
	);
}
