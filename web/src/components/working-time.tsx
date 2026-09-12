import { useEffect, useState } from "react";

export function WorkingTime({ streaming, startedAt, finishedAt, inline = false }: {
 streaming: boolean;
 startedAt?: number;
 finishedAt?: number;
 inline?: boolean;
}) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!streaming) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [streaming, startedAt]);
	const seconds = startedAt === undefined || (!streaming && finishedAt === undefined) ? null : Math.max(0, Math.floor(((finishedAt ?? now) - startedAt) / 1000));
	const duration = seconds === null ? null : seconds < 60 ? `${seconds}s` : seconds < 3600
		? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
		: `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
	const Tag = inline ? "span" : "div";
	return (
		<Tag className={inline ? "tabular-nums" : "mb-3 border-b border-line/60 pb-3 text-[13px] text-muted tabular-nums"} aria-live="off">
			{streaming ? "Working" : "Worked"}{duration ? ` for ${duration}` : streaming ? "…" : ""}
		</Tag>
	);
}
