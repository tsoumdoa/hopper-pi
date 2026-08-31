import { describe, expect, it } from "vitest";
import { isolatedResourceLoaderOptions } from "./pi-runtime.js";

describe("embedded Pi isolation", () => {
	it("loads only Hopper factories and explicit Hopper skills", () => {
		const options = isolatedResourceLoaderOptions("/hopper");
		expect(options).toMatchObject({
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			additionalSkillPaths: ["/hopper/mds/skills", "/hopper/mds/reference"],
		});
		expect(options.extensionFactories).toEqual([
			expect.objectContaining({ name: "hopper", factory: expect.any(Function) }),
			expect.objectContaining({ name: "hopper-choices", factory: expect.any(Function) }),
		]);
	});
});
