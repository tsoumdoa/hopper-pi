import { Close as DialogClose } from "@radix-ui/react-dialog";
import { randomId } from "../lib/random-id";
import { ChevronLeft, ChevronRight, Copy, ImagePlus, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImageAttachment } from "../../../src/host/protocol";
import { imageUrl, type DraftImage } from "../lib/image-attachments";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Tooltip } from "./ui/tooltip";

export const ImageAttachmentContext = createContext<{ attach?: (image: DraftImage) => void; unavailable?: string }>({ unavailable: "Open an editable chat to attach images" });
type GalleryImage = { image: ImageAttachment; label: string };

const imageOverlay = "image-chrome image-chrome-top absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 px-3 pb-8 pt-2 text-ink [&_button]:rounded-none";

async function pngBlob(image: ImageAttachment): Promise<Blob> {
	const element = new Image();
	element.src = imageUrl(image);
	await element.decode();
	const canvas = document.createElement("canvas");
	canvas.width = element.naturalWidth;
	canvas.height = element.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Image copying is unavailable.");
	context.drawImage(element, 0, 0);
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not copy image.")), "image/png"));
}

export function ImageGallery({ images }: { images: GalleryImage[] }) {
	const { attach, unavailable } = useContext(ImageAttachmentContext);
	const [selected, setSelected] = useState<number | null>(null);
	const [notice, setNotice] = useState("");
	const [controlsVisible, setControlsVisible] = useState(false);
	const preview = useRef<HTMLElement>(null);
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const swiped = useRef(false);
	const [copying, setCopying] = useState(false);
	const dimensions = useRef(new Map<string, { width: number; height: number }>());
	const thumbnails = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		thumbnails.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}, [selected]);
	if (!images.length) return null;
	const active = selected === null ? null : images[selected];
	async function copy(image: ImageAttachment) {
		setNotice(""); setCopying(true);
		try {
			if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image copying is unavailable in this browser.");
			const blob = pngBlob(image);
			// A permission rejection can happen before the clipboard consumes the image promise.
			void blob.catch(() => {});
			await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
			setNotice("Image copied");
		} catch { setNotice("Could not copy image. Check clipboard permissions and try again."); }
		finally { setCopying(false); }
	}
	function actions(item: GalleryImage) {
		return <div className="flex items-center gap-1">
			<Button variant="ghost" size="icon-sm" aria-label="Copy image to clipboard" disabled={copying} onClick={() => void copy(item.image)}><Copy className="size-3.5" /></Button>
			<Button variant="ghost" size="icon-sm" aria-label="Attach image to chat" title={unavailable ?? "Attach image to chat"} disabled={!attach} onClick={() => {
				const size = dimensions.current.get(imageUrl(item.image));
				if (!size) { setNotice("Wait for the image to load before attaching it."); return; }
				attach?.({ id: randomId(), name: item.label, image: item.image, original: item.image, ...size });
				setNotice("Image attached to chat");
			}}><ImagePlus className="size-3.5" /></Button>
		</div>;
	}
	return <div className="min-w-0 max-w-full space-y-2 whitespace-normal">
		<div className="flex items-start snap-x snap-proximity gap-3 overflow-x-auto pb-2" role="region" aria-label="Images" tabIndex={0}>
			{images.map((item, index) => <figure key={index} className="image-view relative max-w-full shrink-0 snap-start">
				<Tooltip content="Expand image"><button type="button" className="block max-w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Expand ${item.label}`} onClick={(event) => { opener.current = event.currentTarget; setNotice(""); setControlsVisible(false); setSelected(index); }}>
					<img src={imageUrl(item.image)} alt={item.label} className="block h-auto max-h-48 w-auto max-w-full" onLoad={(event) => dimensions.current.set(imageUrl(item.image), { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
				</button></Tooltip>
				<figcaption className={imageOverlay}><span className="min-w-0 truncate pt-1.5 text-[11px]">{item.label}</span>{actions(item)}</figcaption>
			</figure>)}
		</div>
		{notice && selected === null && <p role="status" className="text-xs text-muted">{notice}</p>}
		<Dialog open={Boolean(active)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
			{active && <DialogContent hideClose overlayClassName="bg-canvas/35 backdrop-blur-xl" onOpenAutoFocus={(event) => { event.preventDefault(); preview.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }} className="image-gallery-dialog left-0 top-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none animate-none" onKeyDown={(event) => {
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSelected(Math.max(0, Math.min(images.length - 1, selected! + (event.key === "ArrowLeft" ? -1 : 1)))); }
			}}>
				<DialogTitle className="sr-only">{active.label}</DialogTitle>
				<DialogDescription className="sr-only">Image preview. Swipe, use the arrow keys, or select a thumbnail to browse images. Tap the image to show or hide controls.</DialogDescription>
				<figure ref={preview} tabIndex={-1} data-controls={controlsVisible} className="image-view relative h-full min-h-0 w-full outline-none">
					<button type="button" aria-label="Show or hide image controls" aria-expanded={controlsVisible} className="block h-full w-full [touch-action:pan-y_pinch-zoom] outline-none" onTouchStart={(event) => {
						swiped.current = false;
						touchStart.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
					}} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={(event) => {
						const start = touchStart.current;
						touchStart.current = null;
						if (!start || !event.changedTouches.length) return;
						const dx = event.changedTouches[0].clientX - start.x;
						const dy = event.changedTouches[0].clientY - start.y;
						if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
							swiped.current = true;
							setSelected(Math.max(0, Math.min(images.length - 1, selected! + (dx < 0 ? 1 : -1))));
						}
					}} onClick={() => {
						if (swiped.current) { swiped.current = false; return; }
						setControlsVisible(!controlsVisible);
					}}>
						<img src={imageUrl(active.image)} alt={active.label} className="block h-full w-full select-none object-contain" draggable={false} />
					</button>
					<figcaption className={cn(imageOverlay, "pt-[max(.5rem,env(safe-area-inset-top))] pl-[max(.75rem,env(safe-area-inset-left))] pr-[max(.75rem,env(safe-area-inset-right))]")}>
						<span className="min-w-0 truncate pt-1.5 text-xs">{active.label}</span>
						<div className="flex items-center gap-1">{actions(active)}<Tooltip content="Close preview"><DialogClose className="flex size-7 items-center justify-center text-ink-soft hover:text-ink focus-visible:outline focus-visible:outline-accent" aria-label="Close preview"><X className="size-3.5" /></DialogClose></Tooltip></div>
					</figcaption>
					{images.length > 1 && <div className="image-chrome image-chrome-bottom absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-8 [&_button]:rounded-none">
						<Button variant="ghost" size="icon-sm" aria-label="Previous image" disabled={selected === 0} onClick={() => setSelected(selected! - 1)}><ChevronLeft className="size-4" /></Button>
						<div ref={thumbnails} className="flex min-w-0 gap-2 overflow-x-auto py-1" aria-label="Image previews">{images.map((item, index) => <Tooltip key={index} content={`Preview ${item.label}`}><button type="button" data-index={index} aria-label={`Preview ${item.label}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={cn("shrink-0 outline-none transition-opacity focus-visible:ring-1 focus-visible:ring-accent", selected === index ? "opacity-90" : "opacity-40 hover:opacity-80")}><img src={imageUrl(item.image)} alt="" className="h-10 w-14 object-contain sm:h-12 sm:w-16" /></button></Tooltip>)}</div>
						<Button variant="ghost" size="icon-sm" aria-label="Next image" disabled={selected === images.length - 1} onClick={() => setSelected(selected! + 1)}><ChevronRight className="size-4" /></Button>
					</div>}
					{notice && <p role="status" className="pointer-events-none absolute inset-x-0 top-12 z-20 text-center text-xs text-ink">{notice}</p>}
				</figure>
			</DialogContent>}
		</Dialog>
	</div>;
}
