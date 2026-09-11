import { Copy } from "lucide-react";
import { useState } from "react";
import type { SharedSnapshot } from "../state/shared-snapshot";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

type Period = "week" | "month" | "year" | "all";
const periods: Record<Period, string> = {
	week: "Older than 1 week",
	month: "Older than 1 month",
	year: "Older than 1 year",
	all: "All archived threads",
};
function cutoff(period: Period, now: number): number | null {
	if (period === "all") return null;
	const date = new Date(now);
	if (period === "week") date.setDate(date.getDate() - 7);
	else {
		const day = date.getDate();
		date.setDate(1);
		date.setMonth(date.getMonth() - (period === "year" ? 12 : 1));
		const lastDay = new Date(
			date.getFullYear(),
			date.getMonth() + 1,
			0,
		).getDate();
		date.setDate(Math.min(day, lastDay));
	}
	return date.getTime();
}

export function ArchivedThreadsDialog({
	snapshot,
	connected,
	busy,
	onClose,
	onPurge,
}: {
	snapshot?: SharedSnapshot;
	connected: boolean;
	busy: boolean;
	onClose(): void;
	onPurge(ids: string[], before: number | null): void;
}) {
	const [period, setPeriod] = useState<Period>("year");
	const [now] = useState(Date.now);
	const [review, setReview] = useState<{
		ids: string[];
		before: number | null;
	}>();
	const [copyMessage, setCopyMessage] = useState("");
	const before = cutoff(period, now);
	const archived =
		snapshot?.conversations.filter((row) => row.archived_at) ?? [];
	const eligible = archived.filter(
		(row) =>
			!row.live_state &&
			!row.recovery_required &&
			(before === null ||
				Number(row.last_activity_at ?? row.created_at) < before),
	);
	const count = review?.ids.length ?? eligible.length;
	const copy = async (path: string) => {
		try {
			await navigator.clipboard.writeText(path);
			setCopyMessage("Path copied");
		} catch {
			setCopyMessage("Couldn't copy. Select the path and copy it manually.");
		}
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent hideClose={busy}>
				<DialogHeader>
					<DialogTitle>
						{review ? "Delete archived threads?" : "Manage archived threads"}
					</DialogTitle>
					<DialogDescription>
						{review
							? `This will permanently delete ${count} archived ${count === 1 ? "thread" : "threads"} and their saved logs. This cannot be undone. Export any threads you want to keep first.`
							: "Free up space by deleting archived conversations you no longer need."}
					</DialogDescription>
				</DialogHeader>
				{!review && (
					<>
						<div className="grid gap-2 rounded-md border border-line bg-panel p-3">
							<p className="text-xs font-medium">Saved on this host</p>
							{snapshot?.historyStorage ? (
								Object.entries({
									"Thread history": snapshot.historyStorage.journalPath,
									"Session files": snapshot.historyStorage.sessionsPath,
								}).map(([label, path]) => (
									<div key={label} className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<p className="text-[11px] text-muted">{label}</p>
											<code className="select-text break-all text-xs">
												{path}
											</code>
										</div>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label={`Copy ${label.toLowerCase()} path`}
											title="Copy path"
											onClick={() => void copy(path)}
										>
											<Copy className="size-3.5" />
										</Button>
									</div>
								))
							) : (
								<p className="text-xs text-muted">
									Saved location unavailable.
								</p>
							)}
							{copyMessage && (
								<p role="status" className="text-xs text-muted">
									{copyMessage}
								</p>
							)}
						</div>
						<label className="grid gap-1.5 text-xs font-medium">
							Delete archived threads
							<select
								value={period}
								onChange={(event) => setPeriod(event.target.value as Period)}
								className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus-visible:outline-accent"
							>
								{Object.entries(periods).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
						<p className="text-xs text-muted">
							Based on last activity
							{before === null
								? "."
								: ` before ${new Date(before).toLocaleString()}.`}
						</p>
						<p role="status" className="text-sm">
							{count
								? `${count} archived ${count === 1 ? "thread matches" : "threads match"}.`
								: "No archived threads match this period."}
						</p>
						{archived.some(
							(row) => row.live_state || row.recovery_required,
						) && (
							<p className="text-xs text-muted">
								Threads still working or needing recovery are excluded.
							</p>
						)}
					</>
				)}
				<DialogFooter>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => (review ? setReview(undefined) : onClose())}
					>
						{review ? "Back" : "Close"}
					</Button>
					<Button
						variant="destructive"
						disabled={!connected || busy || !count}
						onClick={() =>
							review
								? onPurge(review.ids, review.before)
								: setReview({
										ids: eligible.map((row) => String(row.id)),
										before,
									})
						}
					>
						{busy
							? "Deleting…"
							: review
								? `Delete ${count} ${count === 1 ? "thread" : "threads"}`
								: "Review deletion"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
