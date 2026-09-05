import { Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { blobAttachment, imageUrl, type DraftImage } from "../lib/image-attachments";
import { Button } from "./ui/button";

export default function ImageAnnotationEditor({ attachment, onSave, onCancel }: {
	attachment: DraftImage;
	onSave(image: DraftImage): void;
	onCancel(): void;
}) {
	const mounted = useRef(true);
	const fitted = useRef(false);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const initialData = useMemo<ExcalidrawInitialDataState>(() => {
		if (attachment.scene) return { ...structuredClone(attachment.scene), scrollToContent: true };
		const fileId = attachment.id as FileId;
		const scale = Math.min(1, 1600 / Math.max(attachment.width, attachment.height));
		return {
			elements: convertToExcalidrawElements([{
				type: "image", x: 0, y: 0, fileId, locked: true,
				width: attachment.width * scale, height: attachment.height * scale,
				status: "saved",
			}]),
			files: { [fileId]: { id: fileId, mimeType: attachment.original.mimeType, dataURL: imageUrl(attachment.original) as DataURL, created: Date.now() } },
			appState: { viewBackgroundColor: "#ffffff", currentItemStrokeColor: "#e03131", currentItemStrokeWidth: 2, currentItemRoughness: 0 },
			scrollToContent: true,
		};
	}, [attachment]);

	const save = async () => {
		if (!api || saving) return;
		setSaving(true);
		setError(null);
		try {
			const elements = api.getSceneElements();
			if (!elements.length) throw new Error("Add an image or annotation before saving.");
			const files = api.getFiles();
			const state = api.getAppState();
			const appState = {
				viewBackgroundColor: state.viewBackgroundColor, exportBackground: true, exportWithDarkMode: false,
				currentItemStrokeColor: state.currentItemStrokeColor, currentItemStrokeWidth: state.currentItemStrokeWidth,
				currentItemRoughness: state.currentItemRoughness, currentItemFontFamily: state.currentItemFontFamily,
				currentItemFontSize: state.currentItemFontSize,
			};
			const blob = await exportToBlob({ elements, files, appState, mimeType: "image/png", maxWidthOrHeight: 2048, exportPadding: 16 });
			const image = await blobAttachment(blob);
			if (!mounted.current) return;
			onSave({ ...attachment, image, scene: { elements: structuredClone(elements), files: { ...files }, appState } });
		} catch (cause) {
			if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save the annotations. Try again.");
		} finally { if (mounted.current) setSaving(false); }
	};

	return <>
		<div className="min-h-0 flex-1 overflow-hidden rounded-sm border border-line">
			<Excalidraw initialData={initialData} excalidrawAPI={setApi} theme="light" autoFocus viewModeEnabled={saving}
				onChange={(elements, state) => {
					if (!api || fitted.current || state.isLoading || !elements.length) return;
					fitted.current = true;
					requestAnimationFrame(() => {
						if (mounted.current) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.8, maxZoom: 1, animate: false });
					});
				}}
				UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, saveAsImage: false }, tools: { image: false } }}
				validateEmbeddable={false}>
				<MainMenu><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
			</Excalidraw>
		</div>
		{error && <p role="alert" className="text-sm text-danger">{error}</p>}
		<div className="flex justify-end gap-2">
			<Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
			<Button onClick={() => void save()} disabled={!api || saving}>{saving ? "Saving…" : "Save annotations"}</Button>
		</div>
	</>;
}
