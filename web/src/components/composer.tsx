import { ArrowUp, ImagePlus, Pencil, RefreshCw, Square, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, KeyboardEvent, ReactNode, SetStateAction } from "react";
import { MAX_IMAGES } from "../../../src/host/protocol";
import { IMAGE_ACCEPT, imageUrl, readImage, type DraftImage } from "../lib/image-attachments";
import { ImageAnnotationDialog } from "./image-annotation-dialog";
import type { SendMode } from "../state/hopper-types";
import { toolbarTriggerClass } from "./model-picker";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const MAX_HEIGHT = 220;

const MODE_LABELS: Record<SendMode, string> = {
	follow_up: "Follow up after turn",
	steer: "Steer current turn",
	prompt: "New turn",
};

/** Compact labels for the toolbar trigger; MODE_LABELS stay in the dropdown for clarity. */
const MODE_TRIGGER_LABELS: Record<SendMode, string> = {
	follow_up: "Follow up",
	steer: "Steer",
	prompt: "New turn",
};

export type ComposerHandle = { focus(): void };

export type ComposerProps = {
	draft: string;
	atBottom?: boolean;
	images: DraftImage[];
	onImagesChange: Dispatch<SetStateAction<DraftImage[]>>;
	attachmentError?: string;
	imagesSupported: boolean;
	onDraftChange(value: string): void;
	mode: SendMode;
	onModeChange(mode: SendMode): void;
	disabled: boolean;
	streaming: boolean;
	/** Cancellation remains available while work is queued or waiting for input. */
	canAbort?: boolean;
	abortDisabled?: boolean;
	onSubmit(): void;
	onAbort(): void;
	/** Toolbar controls rendered at the start of the bottom row (model, thinking, Rhino target). */
	controls?: ReactNode;
	/** Blocks sending while keeping the draft editable, e.g. when the chosen Rhino model disconnected. */
	submitDisabled?: boolean;
	/** Explains why sending is blocked. Shown above the text field like attachment errors. */
	alert?: ReactNode;
	/** Overrides the placeholder while the composer is disabled for a reason other than connecting. */
	placeholder?: string;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{ draft, atBottom = true, onDraftChange, images, onImagesChange, attachmentError, imagesSupported, mode, onModeChange, disabled, streaming, canAbort = streaming, abortDisabled = false, onSubmit, onAbort, controls, submitDisabled, alert, placeholder },
	ref,
) {
	const fileInput = useRef<HTMLInputElement>(null);
	const replaceId = useRef<string | null>(null);
	const [editor, setEditor] = useState<{ kind: "new" } | { kind: "existing"; id: string } | null>(null);
	const [loading, setLoading] = useState(false);
	const [imageError, setImageError] = useState<string | null>(null);
	const loadGeneration = useRef(0);
	useEffect(() => () => { loadGeneration.current++; }, []);
	const editing = editor?.kind === "existing" ? images.find((image) => image.id === editor.id) : undefined;
	const newDrawing = editor?.kind === "new";
	const addImages = async (files: File[], replacement: string | null = null) => {
		if (disabled || loading || !files.length) return;
		setImageError(null);
		if (!replacement && images.length + files.length > MAX_IMAGES) { setImageError(`Attach up to ${MAX_IMAGES} images.`); return; }
		setLoading(true);
		const generation = ++loadGeneration.current;
		try {
			const loaded = await Promise.all((replacement ? files.slice(0, 1) : files).map(readImage));
			if (generation !== loadGeneration.current) return;
			onImagesChange((latest) => replacement ? latest.map((image) => image.id === replacement ? loaded[0] : image) : [...latest, ...loaded]);
		} catch (cause) { if (generation === loadGeneration.current) setImageError(cause instanceof Error ? cause.message : "Could not open this image."); }
		finally { if (generation === loadGeneration.current) setLoading(false); }
	};
	const textarea = useRef<HTMLTextAreaElement>(null);
	const [focused, setFocused] = useState(false);
	const expanded = atBottom || focused;
	useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

	useLayoutEffect(() => {
		const node = textarea.current;
		if (!node) return;
		node.style.height = "auto";
		node.style.height = expanded ? `${Math.max(88, Math.min(node.scrollHeight, MAX_HEIGHT))}px` : "40px";
		node.style.overflowY = expanded && node.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
	}, [draft, expanded]);

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (!canSend) return;
		onSubmit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	const canSend = !disabled && !submitDisabled && !loading && (draft.trim().length > 0 || images.length > 0) && (!images.length || imagesSupported);
	const showStop = canAbort && !canSend;

	return (
		<footer className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
			<form
				onSubmit={submit}
				onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
				onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)); } }}
				className="relative mx-auto w-full max-w-[760px] rounded-md border border-line bg-surface transition-colors focus-within:border-accent/60"
			>
				<input ref={fileInput} type="file" accept={IMAGE_ACCEPT} multiple={!replaceId.current} className="sr-only" tabIndex={-1} aria-label="Choose images" disabled={disabled || loading}
					onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; const replacement = replaceId.current; replaceId.current = null; void addImages(files, replacement); }} />
				{images.length > 0 && <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-2" aria-label="Image attachments">
					{images.map((image) => <div key={image.id} className="w-36 shrink-0 overflow-hidden rounded-[2px] border border-line bg-panel">
						<button type="button" className="block w-full" disabled={disabled || loading} onClick={() => setEditor({ kind: "existing", id: image.id })} aria-label={`Annotate ${image.name}`}>
							<img src={imageUrl(image.image)} alt={image.name} className="h-20 w-full object-contain" />
						</button>
						<p className="truncate px-1.5 pt-1 text-[11px] text-muted" title={image.name}>{image.name}</p>
						<div className="flex items-center justify-between p-1">
							<Button type="button" variant="ghost" size="icon-sm" disabled={disabled || loading} onClick={() => setEditor({ kind: "existing", id: image.id })} aria-label={`Edit annotations on ${image.name}`} title="Annotate"><Pencil className="size-3.5" /></Button>
							<Button type="button" variant="ghost" size="icon-sm" disabled={disabled || loading} onClick={() => { replaceId.current = image.id; if (fileInput.current) { fileInput.current.multiple = false; fileInput.current.click(); } }} aria-label={`Replace ${image.name}`} title="Replace image"><RefreshCw className="size-3.5" /></Button>
							<Button type="button" variant="ghost" size="icon-sm" disabled={disabled || loading} onClick={() => onImagesChange((latest) => latest.filter((item) => item.id !== image.id))} aria-label={`Remove ${image.name}`} title="Remove image"><X className="size-3.5" /></Button>
						</div>
					</div>)}
				</div>}
				{loading && <p role="status" className="px-3 pt-2 text-xs text-muted">Opening images…</p>}
				{(imageError || attachmentError) && <p role="alert" className="px-3 pt-2 text-xs text-danger">{imageError || attachmentError}</p>}
				{images.length > 0 && !imagesSupported && <p role="alert" className="px-3 pt-2 text-xs text-danger">Select a model that supports images to send these attachments.</p>}
				{alert && <p role="alert" className="px-3 pt-2 text-xs text-danger">{alert}</p>}
				<label className="sr-only" htmlFor="composer-input">Message Hopper</label>
				<textarea
					id="composer-input"
					ref={textarea}
					rows={1}
					value={draft}
					readOnly={disabled}
					aria-disabled={disabled}
					autoComplete="off"
					onChange={(event) => onDraftChange(event.target.value)}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onKeyDown={onKeyDown}
					onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); void addImages(files); } }}
					placeholder={disabled ? placeholder ?? "Waiting for the Hopper host…" : "Ask Hopper…"}
					className="block min-h-[40px] max-h-[220px] w-full resize-none bg-transparent pb-1 pl-3.5 pr-11 pt-3 text-[14px] leading-6 outline-none placeholder:text-muted aria-disabled:cursor-not-allowed"
				/>
				<div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5 pr-11 pt-0.5">
					<Button type="button" variant="ghost" size="icon-sm" disabled={disabled || loading || images.length >= MAX_IMAGES} aria-label="Attach images" title="Attach images, or paste a screenshot" onClick={() => { replaceId.current = null; if (fileInput.current) { fileInput.current.multiple = true; fileInput.current.click(); } }}><ImagePlus className="size-4" /></Button>
					<Button type="button" variant="ghost" size="icon-sm" disabled={disabled || loading || images.length >= MAX_IMAGES} aria-label="New drawing" title="Draw on a blank canvas" onClick={() => { setImageError(null); setEditor({ kind: "new" }); }}><Pencil className="size-4" /></Button>
					{controls}
					{streaming && (
						<Select value={mode} onValueChange={(value) => onModeChange(value as SendMode)}>
							<SelectTrigger aria-label="Message delivery" className={toolbarTriggerClass}>
								<SelectValue>{MODE_TRIGGER_LABELS[mode]}</SelectValue>
							</SelectTrigger>
							<SelectContent align="start">
								{(Object.keys(MODE_LABELS) as SendMode[]).map((value) => (
									<SelectItem key={value} value={value}>{MODE_LABELS[value]}</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
				<Button
					className="absolute bottom-1.5 right-1.5 shadow-sm"
					type={showStop ? "button" : "submit"}
					size="icon-sm"
					disabled={showStop ? abortDisabled : !canSend}
					onClick={showStop ? onAbort : undefined}
					aria-label={showStop ? "Stop" : "Send message"}
					title={showStop ? "Stop" : "Send (Enter)"}
				>
					{showStop ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
				</Button>
			</form>
			{(editing || newDrawing) && <ImageAnnotationDialog key={editing?.id ?? "new-drawing"} attachment={editing}
				onClose={() => setEditor(null)}
				onSave={(updated) => {
					onImagesChange((latest) => newDrawing ? [...latest, updated] : latest.map((image) => image.id === updated.id ? updated : image));
					setEditor(null);
				}} />}
		</footer>
	);
});
