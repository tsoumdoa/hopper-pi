import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatDocHeader } from "./canvas-formatter.js";
import {
	resetRhinoVisualCaptureState,
	setRhinoVisualCaptureConsent,
} from "../services/rhino-visual-consent.js";
import type { GetCurrentCanvasResponse } from "../types/messages.js";

function response(overrides: Partial<GetCurrentCanvasResponse> = {}): GetCurrentCanvasResponse {
	return {
		type: "getCurrentCanvas.response",
		timestamp: 0,
		docName: "Untitled",
		xml: "",
		...overrides,
	};
}

describe("formatDocHeader", () => {
	let savedEnv: string | undefined;

	beforeEach(() => {
		savedEnv = process.env.HOPPER_RHINO_CAPTURE_CONSENT;
		delete process.env.HOPPER_RHINO_CAPTURE_CONSENT;
		resetRhinoVisualCaptureState();
	});

	afterEach(() => {
		if (savedEnv !== undefined) process.env.HOPPER_RHINO_CAPTURE_CONSENT = savedEnv;
		resetRhinoVisualCaptureState();
	});

	it("reports units, tolerance, and unset capture consent", () => {
		const header = formatDocHeader(response({ units: "Meters", absoluteTolerance: 0.001 }));
		expect(header).toBe("Untitled · units=Meters, tol=0.001, capture=unset");
	});

	it("reports allowed capture consent", () => {
		setRhinoVisualCaptureConsent(true);
		expect(formatDocHeader(response())).toBe("Untitled · capture=allowed");
	});

	it("reports denied capture consent", () => {
		setRhinoVisualCaptureConsent(false);
		expect(formatDocHeader(response())).toBe("Untitled · capture=denied");
	});
});
