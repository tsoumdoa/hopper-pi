import { describe, expect, it } from "vitest";
import { isolatedResourceLoaderOptions, providerAuthMethods } from "./pi-runtime.js";

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

	it("advertises only provider auth methods that can start a login", () => {
		expect(providerAuthMethods({
			apiKey: { name: "Example API key", login: () => undefined },
			oauth: { name: "Example account", loginLabel: "Sign in with Example" },
		})).toEqual([
			{ type: "api_key", label: "Example API key" },
			{ type: "oauth", label: "Sign in with Example" },
		]);
		expect(providerAuthMethods({ apiKey: { name: "Ambient credentials" } })).toEqual([]);
	});
});
