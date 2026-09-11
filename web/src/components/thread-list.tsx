import {
	Archive,
	ArchiveRestore,
	ChevronDown,
	Ellipsis,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TargetBinding } from "../../../src/protocol/shared-execution";
import { cn } from "../lib/utils";
import {
	bindingLabeler,
	decode,
	type Row,
	type SharedSnapshot,
} from "../state/shared-snapshot";

export function ThreadList({
	snapshot,
	selectedId,
	connected,
	onSelect,
	onArchive,
	onDelete,
	onManageArchived,
}: {
	snapshot?: SharedSnapshot;
	selectedId: string;
	connected: boolean;
	onSelect(id: string): void;
	onArchive(row: Row): void;
	onDelete(row: Row): void;
	onManageArchived(): void;
}) {
	const [now, setNow] = useState(Date.now);
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	const rows = [...(snapshot?.conversations ?? [])].sort(
		(a, b) =>
			Number(b.last_activity_at ?? b.created_at) -
				Number(a.last_activity_at ?? a.created_at) ||
			Number(b.sequence) - Number(a.sequence),
	);
	const archived = rows.filter((row) => row.archived_at);
	const labelFor = bindingLabeler(snapshot);
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	const week = new Date(today);
	week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
	const group = (row: Row) => {
		const time = Number(row.last_activity_at ?? row.created_at);
		return time >= +today
			? "Today"
			: time >= +yesterday
				? "Yesterday"
				: time >= +week
					? "This week"
					: "Older";
	};
	const renderRow = (row: Row) => {
		const id = String(row.id),
			live = Boolean(row.live_state),
			waiting = row.live_state === "awaiting_user";
		const status = waiting
			? "Answer needed"
			: live
				? "Working"
				: row.recovery_required
					? "Recovery required"
					: "";
		const age = Math.max(
			0,
			now - Number(row.last_activity_at ?? row.created_at),
		);
		const when =
			age < 60_000
				? "now"
				: age < 3_600_000
					? `${Math.floor(age / 60_000)}m`
					: age < 86_400_000
						? `${Math.floor(age / 3_600_000)}h`
						: `${Math.floor(age / 86_400_000)}d`;
		const target = decode<TargetBinding | null>(row.document_target, null);
		return (
			<div
				key={id}
				className={cn(
					"group relative flex items-center rounded-md border border-transparent hover:bg-surface focus-within:bg-surface",
					selectedId === id && "border-line bg-surface shadow-sm",
				)}
			>
				<button
					type="button"
					disabled={!connected}
					onClick={() => onSelect(id)}
					aria-current={selectedId === id ? "page" : undefined}
					title={String(row.first_user_text || row.title)}
					className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<span
						aria-label={status || "Inactive"}
						className={cn(
							"mt-1.5 size-[7px] shrink-0 rounded-full bg-line-strong",
							live && "bg-accent motion-safe:animate-pulse",
							waiting && "bg-warn",
							!live && Boolean(row.recovery_required) && "bg-danger",
						)}
					/>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[12.5px] font-medium">
							{row.title}
						</span>
						<span className="block truncate text-[10.5px] text-muted">
							{row.document_label ||
								(target ? labelFor(target) : "No document")}
							{status ? ` · ${status}` : ""}
						</span>
					</span>
					<span className="mt-0.5 text-[10px] text-muted group-hover:opacity-0 group-focus-within:opacity-0">
						{when}
					</span>
				</button>
				<span className="absolute right-1 flex gap-0.5 rounded bg-surface opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:opacity-100">
					<button
						type="button"
						disabled={!connected || live}
						title={
							live
								? "Stop the running thread first"
								: row.archived_at
									? "Unarchive"
									: "Archive"
						}
						aria-label={`${row.archived_at ? "Unarchive" : "Archive"} ${row.title}`}
						onClick={() => onArchive(row)}
						className="rounded p-1 text-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30"
					>
						{row.archived_at ? (
							<ArchiveRestore className="size-3.5" />
						) : (
							<Archive className="size-3.5" />
						)}
					</button>
					<button
						type="button"
						disabled={!connected || live}
						title={
							live ? "Stop the running thread first" : "Delete permanently"
						}
						aria-label={`Delete ${row.title}`}
						onClick={() => onDelete(row)}
						className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"
					>
						<Trash2 className="size-3.5" />
					</button>
				</span>
			</div>
		);
	};
	return (
		<nav
			aria-label="Thread history"
			className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
		>
			{!rows.some((row) => !row.archived_at) && (
				<p className="px-2 py-4 text-xs text-muted">
					No threads yet. Start one above.
				</p>
			)}
			{["Today", "Yesterday", "This week", "Older"].map((label) => {
				const members = rows.filter(
					(row) => !row.archived_at && group(row) === label,
				);
				return members.length ? (
					<section key={label} aria-label={label}>
						<h2 className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
							{label}
						</h2>
						{members.map(renderRow)}
					</section>
				) : null;
			})}
			{archived.length > 0 && (
				<section className="mt-2 border-t border-line pt-1">
					<div className="flex items-center">
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							aria-expanded={expanded}
							className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs text-ink-soft"
						>
							<Archive className="size-3.5" />
							Archived ({archived.length})
							<ChevronDown
								className={cn("ml-auto size-3.5", expanded && "rotate-180")}
							/>
						</button>
						<button
							type="button"
							aria-label="Manage archived threads"
							title="Manage archived threads"
							onClick={onManageArchived}
							className="shrink-0 rounded p-1.5 text-muted hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
						>
							<Ellipsis className="size-4" />
						</button>
					</div>
					{expanded && (
						<>
							<p className="px-2 pb-1 text-[10px] text-muted">
								Read-only. Unarchive to continue.
							</p>
							{archived.map(renderRow)}
						</>
					)}
				</section>
			)}
		</nav>
	);
}
