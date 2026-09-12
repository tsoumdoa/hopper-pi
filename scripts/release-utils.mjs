import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const versionFiles = ["package.json", "dotnet/Hopper.Rhino/Hopper.Rhino.csproj", "dotnet/Hopper.Grasshopper/Hopper.Grasshopper.csproj"];

export function nextVersion(current, requested) {
	const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
	if (!stable.test(current)) throw new Error("Current version must be a stable major.minor.patch version.");
	const parts = current.split(".").map(Number);
	if (["major", "minor", "patch"].includes(requested)) {
		const index = ["major", "minor", "patch"].indexOf(requested);
		parts[index]++;
		for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
		return parts.join(".");
	}
	if (!stable.test(requested)) throw new Error("Use patch, minor, major, or a stable version such as 0.3.0.");
	const next = requested.split(".").map(Number);
	const difference = next.findIndex((part, index) => part !== parts[index]);
	if (difference === -1 || next[difference] < parts[difference]) throw new Error("The new version must be greater than the current version.");
	return requested;
}

export function versionEdits(root, requested) {
	const originals = versionFiles.map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
	const current = JSON.parse(originals[0].text).version;
	const version = nextVersion(current, requested);
	return { current, version, edits: originals.map(({ file, text }, index) => {
		if (index === 0) return { file, text: text.replace(/("version"\s*:\s*")[^"]+"/, `$1${version}"`) };
		const matches = [...text.matchAll(/<Version>([^<]+)<\/Version>/g)];
		if (matches.length !== 1 || matches[0][1] !== current) throw new Error(`Version mismatch in ${file}; expected ${current}. No files changed.`);
		return { file, text: text.replace(/<Version>[^<]+<\/Version>/, `<Version>${version}</Version>`) };
	}) };
}

export function releaseArchives(root, version, output) {
	return ["mac-arm64", "win-x64"].map((target) => {
		const folder = output ? resolve(root, output, target) : join(root, "artifacts", `hopper-pi-${version}-${target}`);
		return { target, folder, file: join(folder, `hopper-pi-${version}-rh8_20-${target === "mac-arm64" ? "mac" : "win"}.yak`), provenance: `${folder}-release.json` };
	});
}

export function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function verifyReleaseArchive(archive, version, commit) {
	const record = JSON.parse(readFileSync(archive.provenance, "utf8"));
	if (record.version !== version || record.target !== archive.target || record.commit !== commit || record.dirty !== false) {
		throw new Error(`${archive.file}: rebuild from the current, clean release commit.`);
	}
	if (record.sha256 !== sha256(archive.file)) throw new Error(`${archive.file}: archive changed since the build.`);
}
