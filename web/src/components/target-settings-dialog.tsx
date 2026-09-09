import type { NextDocumentAction, SharedBrowserCommand } from "../../../src/host/shared/browser-protocol.js";
import type { TargetBinding } from "../../../src/protocol/shared-execution.js";
import { bindingLabeler, readyTargets, sameBinding, type SharedSnapshot } from "../state/shared-snapshot";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export type LaunchSelection = Extract<SharedBrowserCommand, { type: "submit" }>["launch"];
export function TargetSettingsDialog({ snapshot, selected, onSelected, documentAction, onDocumentAction, launch, onLaunch, disabled, onOpenChange }: {
	snapshot: SharedSnapshot | undefined;
	selected: TargetBinding[];
	onSelected(value: TargetBinding[]): void;
	documentAction: NextDocumentAction | undefined;
	onDocumentAction(value: NextDocumentAction | undefined): void;
	launch: LaunchSelection;
	onLaunch(value: LaunchSelection): void;
	disabled: boolean;
	onOpenChange(open: boolean): void;
}) {
	const targets = readyTargets(snapshot);
	const labelFor = bindingLabeler(snapshot);
	const hasProcess = snapshot?.targets.some((target) => target.admission !== "detached") ?? false;
	const field = "mt-1 w-full rounded border border-line bg-canvas p-2 text-xs";
	return <Dialog open onOpenChange={onOpenChange}>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Message targets</DialogTitle>
				<DialogDescription>Select up to 16 documents for the next message. Edits in the same Rhino process run sequentially.</DialogDescription>
			</DialogHeader>
			<fieldset disabled={disabled} className="grid gap-4 text-xs disabled:opacity-50">
				{targets.map((target) => <section key={target.lifecycleInstanceId} className="grid gap-2">
					<p className="font-medium">{target.label} · PID {target.processId}</p>
					{target.documents.map((binding) => <label key={JSON.stringify(binding)} className="flex items-center gap-2">
						<input type="checkbox" checked={selected.some((item) => sameBinding(item, binding))}
							disabled={selected.length >= 16 && !selected.some((item) => sameBinding(item, binding))}
							onChange={(event) => {
								onLaunch(undefined);
								onSelected(event.target.checked ? [...selected, binding] : selected.filter((item) => !sameBinding(item, binding)));
							}} />
						{labelFor(binding)}
					</label>)}
					<div className="flex gap-2">
						{(["new", "open"] as const).map((action) => <Button key={action} size="xs" variant="secondary" onClick={() => {
							onLaunch(undefined);
							onDocumentAction({ lifecycleInstanceId: target.lifecycleInstanceId, kind: "rhino", action, modifiedPolicy: "refuse" });
						}}>{action === "new" ? "New document" : "Open document"}</Button>)}
					</div>
				</section>)}
				{selected.some((binding) => !targets.some((target) => target.documents.some((item) => sameBinding(item, binding)))) &&
					<Button size="xs" variant="secondary" onClick={() => onSelected(selected.filter((binding) => targets.some((target) => target.documents.some((item) => sameBinding(item, binding)))))}>Remove unavailable targets</Button>}
				{!targets.length && <p className="text-muted">Run _HopperCode in Rhino to attach an instance, or select an available launch below.</p>}
				{snapshot?.installations?.filter((installation) => installation.platform !== "darwin" || !hasProcess).map((installation) =>
					<Button key={installation.id} size="sm" variant="secondary" disabled={!installation.bootstrapVerified} title={installation.unavailableReason}
						onClick={() => {
							onSelected([]);
							onDocumentAction(undefined);
							onLaunch({ installationId: installation.id, independentProcess: hasProcess });
						}}>Launch Rhino · {installation.id}</Button>)}
				{documentAction && <section className="grid gap-2 rounded border border-line p-3">
					<p className="font-medium">{documentAction.action === "new" ? "Create one document" : "Open one document"} with the next message</p>
					<label>Document kind<select aria-label="Document action kind" className={field} value={documentAction.kind} onChange={(event) => onDocumentAction({ lifecycleInstanceId: documentAction.lifecycleInstanceId, action: documentAction.action, kind: event.target.value as NextDocumentAction["kind"], modifiedPolicy: "refuse" })}>
						<option value="rhino">Rhino model</option><option value="grasshopper">Grasshopper canvas</option>
					</select></label>
					{documentAction.action === "open" && <label>Full path to open<input aria-label="Document path to open" className={field} value={documentAction.path ?? ""} onChange={(event) => onDocumentAction({ ...documentAction, path: event.target.value })} /></label>}
					<label>If an existing document would be replaced<select aria-label="Modified document policy" className={field} value={documentAction.modifiedPolicy} onChange={(event) => {
						const { savePath: _path, overwrite: _overwrite, ...base } = documentAction;
						onDocumentAction({ ...base, modifiedPolicy: event.target.value as NextDocumentAction["modifiedPolicy"] });
					}}>
						<option value="refuse">Keep changes and stop the action</option><option value="save">Save changes first</option><option value="discard">Discard unsaved changes</option>
					</select></label>
					{documentAction.modifiedPolicy === "save" && <>
						<label>Save path<input aria-label="Replacement save path" className={field} value={documentAction.savePath ?? ""} placeholder="Leave blank to use the existing file path" onChange={(event) => {
							const { savePath: _path, ...base } = documentAction;
							onDocumentAction({ ...base, ...(event.target.value ? { savePath: event.target.value } : {}) });
						}} /></label>
						<label className="flex gap-2"><input type="checkbox" checked={documentAction.overwrite === true} onChange={(event) => onDocumentAction({ ...documentAction, overwrite: event.target.checked })} />Allow overwriting the save destination</label>
					</>}
					{documentAction.modifiedPolicy === "discard" && <p className="text-danger">This authorizes losing unsaved changes in the document being replaced.</p>}
					<p className="text-muted">On Mac, a new Rhino document opens in the same process. Existing model windows stay open.</p>
					<Button size="xs" variant="ghost" onClick={() => onDocumentAction(undefined)}>Remove document action</Button>
				</section>}
				{launch && <section className="grid gap-2 rounded border border-line p-3">
					<p>The next message may launch one Rhino process using {launch.installationId}.</p>
					<Button size="xs" variant="ghost" onClick={() => onLaunch(undefined)}>Remove launch</Button>
				</section>}
			</fieldset>
			<DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
		</DialogContent>
	</Dialog>;
}
