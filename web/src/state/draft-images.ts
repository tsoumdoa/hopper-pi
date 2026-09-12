import type { SetStateAction } from "react";
import { MAX_IMAGES } from "../../../src/host/protocol";
import type { DraftImage } from "../lib/image-attachments";

export type DraftImagesState = { images: DraftImage[]; error?: string };

/** Apply every attachment source against the latest draft, including pending uploads. */
export function draftImagesReducer(state: DraftImagesState, update: SetStateAction<DraftImage[]>): DraftImagesState {
	const images = typeof update === "function" ? update(state.images) : update;
	return images.length > MAX_IMAGES
		? { ...state, error: `Attach up to ${MAX_IMAGES} images. Remove an image and try again.` }
		: { images };
}
