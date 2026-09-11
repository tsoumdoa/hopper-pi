# Thread history

The sidebar lists saved threads by last activity, grouped into Today, Yesterday,
This week, and Older. Select a thread to revisit its transcript. Titles come from
the first user message, limited to eight words or 60 characters. New threads keep
the target document's name even after that document closes.

One thread can hold the host's work slot. Queued work and questions awaiting an
answer hold that slot too. Other threads remain available to read, with a Jump
back button. Follow-ups in the live thread queue behind its current task.
Delegated workers can still run concurrently under that root task.

Archive hides a thread in the expandable Archived section. Archived transcripts
remain readable, including older pages. Unarchive restores the composer. An Undo
notification appears after archiving. Live threads cannot be archived or deleted.

Delete asks for confirmation, then removes the transcript, task records, and Pi
session files. Export the thread first to keep a copy. Threads with unresolved
native recovery must be reviewed before deletion. Request tombstones remain so
reconnecting clients cannot replay deleted work. File cleanup survives a restart
if interrupted.

History remains visible across host restarts. Automatic selection still observes
the host session boundary. Missing or archived saved selections fall back to an
eligible visible thread, or a fresh thread when none is eligible. Deleting the
selected thread selects the newest remaining unarchived thread.

The three-dot menu beside Archived opens Manage archived threads. It shows the
saved history and session-file locations with Copy path buttons. Cleanup selects
threads older than one week, one calendar month, or one calendar year, or all
archived threads. It uses last activity and previews the count before confirmation.
The host rechecks the exact previewed selection; a restored thread or activity outside the chosen
period invalidates the batch. Live threads and unresolved recovery are excluded.

Journal schema version 6 adds archive timestamps, saved document names, a
monotonic conversation sequence, and pending session-file cleanup. Shared Rhino
attachment records belong to the host and are retained when a thread is deleted.
