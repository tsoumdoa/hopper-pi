#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	NATIVE_CANDIDATE_EXTENSIONS,
	PACKAGE_MANIFEST_NAME,
	RHINO_PACKAGE_TARGETS,
	evaluatePackagePath,
	normalizePackagePath,
} from "./rhino-package-rules.mjs";

const PE_MACHINE = Object.freeze({
	0x014c: "x86",
	0x8664: "x64",
	0xaa64: "arm64",
});

const MACH_CPU = Object.freeze({
	0x00000007: "x86",
	0x01000007: "x64",
	0x0000000c: "arm",
	0x0100000c: "arm64",
});

const ELF_MACHINE = Object.freeze({
	0x0003: "x86",
	0x003e: "x64",
	0x0028: "arm",
	0x00b7: "arm64",
});

function hasBytes(buffer, offset, length) {
	return offset >= 0 && length >= 0 && offset + length <= buffer.length;
}

function cpuName(table, value) {
	return table[value] ?? `unknown-0x${value.toString(16)}`;
}

function readPeInfo(buffer) {
	if (!hasBytes(buffer, 0, 0x40) || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null;
	const peOffset = buffer.readUInt32LE(0x3c);
	if (!hasBytes(buffer, peOffset, 24) || buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") return null;

	const machineValue = buffer.readUInt16LE(peOffset + 4);
	const sectionCount = buffer.readUInt16LE(peOffset + 6);
	const optionalSize = buffer.readUInt16LE(peOffset + 20);
	const optionalOffset = peOffset + 24;
	if (!hasBytes(buffer, optionalOffset, optionalSize) || optionalSize < 2) {
		return { format: "pe", os: "win32", architectures: [cpuName(PE_MACHINE, machineValue)], managed: false };
	}

	const optionalMagic = buffer.readUInt16LE(optionalOffset);
	const dataDirectoriesOffset = optionalMagic === 0x10b
		? optionalOffset + 96
		: optionalMagic === 0x20b
			? optionalOffset + 112
			: -1;
	let cliHeaderOffset = null;
	const optionalEnd = optionalOffset + optionalSize;
	const directoryCountOffset = dataDirectoriesOffset - 4;
	const directoryCount = directoryCountOffset >= optionalOffset && hasBytes(buffer, directoryCountOffset, 4)
		? buffer.readUInt32LE(directoryCountOffset)
		: 0;
	if (
		dataDirectoriesOffset !== -1
		&& directoryCount > 14
		&& dataDirectoriesOffset + 15 * 8 <= optionalEnd
		&& hasBytes(buffer, dataDirectoriesOffset + 14 * 8, 8)
	) {
		const cliDirectoryOffset = dataDirectoriesOffset + 14 * 8;
		const cliRva = buffer.readUInt32LE(cliDirectoryOffset);
		const cliSize = buffer.readUInt32LE(cliDirectoryOffset + 4);
		if (cliRva !== 0 && cliSize >= 72) {
			const sizeOfHeadersOffset = optionalOffset + 60;
			const sizeOfHeaders = hasBytes(buffer, sizeOfHeadersOffset, 4)
				? buffer.readUInt32LE(sizeOfHeadersOffset)
				: 0;
			if (cliRva < sizeOfHeaders && hasBytes(buffer, cliRva, 72)) {
				cliHeaderOffset = cliRva;
			} else {
				const sectionTableOffset = optionalOffset + optionalSize;
				for (let index = 0; index < sectionCount; index += 1) {
					const sectionOffset = sectionTableOffset + index * 40;
					if (!hasBytes(buffer, sectionOffset, 40)) break;
					const virtualSize = buffer.readUInt32LE(sectionOffset + 8);
					const virtualAddress = buffer.readUInt32LE(sectionOffset + 12);
					const rawSize = buffer.readUInt32LE(sectionOffset + 16);
					const rawOffset = buffer.readUInt32LE(sectionOffset + 20);
					const addressSpan = Math.max(virtualSize, rawSize);
					if (cliRva < virtualAddress || cliRva >= virtualAddress + addressSpan) continue;
					const candidate = rawOffset + cliRva - virtualAddress;
					if (hasBytes(buffer, candidate, 72)) cliHeaderOffset = candidate;
					break;
				}
			}
		}
	}

	const managed = cliHeaderOffset !== null && buffer.readUInt32LE(cliHeaderOffset) >= 72;
	return {
		format: "pe",
		os: managed ? "managed" : "win32",
		architectures: managed ? ["any"] : [cpuName(PE_MACHINE, machineValue)],
		managed,
	};
}

function readElfInfo(buffer) {
	if (!hasBytes(buffer, 0, 20) || buffer[0] !== 0x7f || buffer.toString("ascii", 1, 4) !== "ELF") return null;
	const endian = buffer[5];
	if (endian !== 1 && endian !== 2) {
		return { format: "elf", os: "linux", architectures: ["unknown-endian"], managed: false };
	}
	const machine = endian === 1 ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
	return { format: "elf", os: "linux", architectures: [cpuName(ELF_MACHINE, machine)], managed: false };
}

function readMachInfo(buffer) {
	if (!hasBytes(buffer, 0, 8)) return null;
	const magic = buffer.subarray(0, 4).toString("hex");
	const thinFormats = {
		feedface: "BE",
		cefaedfe: "LE",
		feedfacf: "BE",
		cffaedfe: "LE",
	};
	if (magic in thinFormats) {
		const cpu = thinFormats[magic] === "LE" ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
		return { format: "mach-o", os: "darwin", architectures: [cpuName(MACH_CPU, cpu)], managed: false };
	}

	const fatFormats = {
		cafebabe: { endian: "BE", entrySize: 20 },
		bebafeca: { endian: "LE", entrySize: 20 },
		cafebabf: { endian: "BE", entrySize: 32 },
		bfbafeca: { endian: "LE", entrySize: 32 },
	};
	const format = fatFormats[magic];
	if (!format) return null;
	const readUInt32 = format.endian === "LE"
		? (offset) => buffer.readUInt32LE(offset)
		: (offset) => buffer.readUInt32BE(offset);
	const architectureCount = readUInt32(4);
	if (architectureCount > 64 || !hasBytes(buffer, 8, architectureCount * format.entrySize)) {
		return { format: "mach-o", os: "darwin", architectures: ["invalid-fat-header"], managed: false };
	}
	const architectures = [];
	for (let index = 0; index < architectureCount; index += 1) {
		architectures.push(cpuName(MACH_CPU, readUInt32(8 + index * format.entrySize)));
	}
	return { format: "mach-o", os: "darwin", architectures, managed: false };
}

export function classifyBinary(buffer, path = "") {
	const pe = readPeInfo(buffer);
	if (pe) return pe;
	const elf = readElfInfo(buffer);
	if (elf) return elf;
	const mach = readMachInfo(buffer);
	if (mach) return mach;
	if (NATIVE_CANDIDATE_EXTENSIONS.has(extnameLower(path))) {
		return { format: "unknown", os: "unknown", architectures: ["unknown"], managed: false };
	}
	return null;
}

function extnameLower(path) {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

export function validateBinaryForTarget(binary, target) {
	if (!binary || binary.managed) return null;
	const expected = RHINO_PACKAGE_TARGETS[target];
	if (!expected) return `unsupported target ${target}`;
	if (binary.os === "unknown") return "native-looking file has an unrecognized binary header";
	if (binary.os !== expected.os) return `${binary.format} targets ${binary.os}, expected ${expected.os}`;
	const wrongArchitectures = binary.architectures.filter((cpu) => cpu !== expected.cpu);
	if (wrongArchitectures.length > 0) {
		return `${binary.format} contains ${wrongArchitectures.join(", ")}, expected only ${expected.cpu}`;
	}
	if (!binary.architectures.includes(expected.cpu)) {
		return `${binary.format} does not contain ${expected.cpu}`;
	}
	return null;
}

async function listFiles(root) {
	const files = [];
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const absolutePath = join(directory, entry.name);
			const relativePath = normalizePackagePath(relative(root, absolutePath));
			const metadata = await lstat(absolutePath);
			if (metadata.isSymbolicLink()) {
				throw new Error(`${relativePath}: symbolic links are not allowed in a release package`);
			}
			if (metadata.isDirectory()) await visit(absolutePath);
			else if (metadata.isFile()) files.push({ absolutePath, relativePath, size: metadata.size });
			else throw new Error(`${relativePath}: unsupported filesystem entry`);
		}
	}
	await visit(root);
	return files;
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export async function verifyRhinoPackage(options) {
	const target = options.target;
	if (!(target in RHINO_PACKAGE_TARGETS)) {
		throw new Error(`--target must be one of: ${Object.keys(RHINO_PACKAGE_TARGETS).join(", ")}`);
	}
	const stage = resolve(options.stage);
	const stageMetadata = await stat(stage);
	if (!stageMetadata.isDirectory()) throw new Error(`Staging path is not a directory: ${stage}`);
	const manifestPath = resolve(options.manifestPath ?? join(stage, PACKAGE_MANIFEST_NAME));
	const manifestRelative = relative(stage, manifestPath);
	const manifestIsInsideStage = manifestRelative !== "" && !manifestRelative.startsWith("..") && !isAbsolute(manifestRelative);
	const files = await listFiles(stage);
	const errors = [];
	const manifestFiles = [];
	const yakFiles = [];

	for (const file of files) {
		if (manifestIsInsideStage && resolve(file.absolutePath) === manifestPath) continue;
		const ruleResult = evaluatePackagePath(file.relativePath, target);
		if (!ruleResult.allowed) {
			errors.push(`${file.relativePath}: ${ruleResult.rule.id}, ${ruleResult.rule.description}`);
			continue;
		}
		if (file.relativePath.toLowerCase().endsWith(".yak")) {
			yakFiles.push({ path: file.relativePath, size: file.size });
			continue;
		}
		const contents = await readFile(file.absolutePath);
		const binary = classifyBinary(contents, file.relativePath);
		const binaryError = validateBinaryForTarget(binary, target);
		if (binaryError) {
			errors.push(`${file.relativePath}: ${binaryError}`);
			continue;
		}
		manifestFiles.push({
			path: file.relativePath,
			size: file.size,
			sha256: createHash("sha256").update(contents).digest("hex"),
		});
	}

	if (errors.length > 0) {
		throw new Error(`Rhino package verification failed:\n${errors.sort().map((error) => `- ${error}`).join("\n")}`);
	}
	manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
	yakFiles.sort((left, right) => left.path.localeCompare(right.path));
	const stagedSize = manifestFiles.reduce((total, file) => total + file.size, 0);
	const manifest = { target, stagedSize, files: manifestFiles };
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	if (!options.quiet) {
		process.stdout.write(`[hopper-pi] Verified ${manifestFiles.length} staged files for ${target}: ${formatBytes(stagedSize)}\n`);
		for (const yak of yakFiles) {
			process.stdout.write(`[hopper-pi] Yak ${yak.path}: ${formatBytes(yak.size)}\n`);
		}
		process.stdout.write(`[hopper-pi] Wrote package manifest: ${manifestPath}\n`);
	}
	return { manifest, manifestPath, yakFiles };
}

function parseArguments(args) {
	let target;
	let manifestPath;
	let stage;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--target") {
			target = args[++index];
			if (!target) throw new Error("--target requires a value");
		} else if (argument === "--manifest") {
			manifestPath = args[++index];
			if (!manifestPath) throw new Error("--manifest requires a value");
		} else if (argument.startsWith("-")) {
			throw new Error(`Unknown option: ${argument}`);
		} else if (stage) {
			throw new Error(`Unexpected argument: ${argument}`);
		} else {
			stage = argument;
		}
	}
	if (!target || !stage) {
		throw new Error("Usage: verify-rhino-package.mjs --target <mac-arm64|win-x64> [--manifest <path>] <staging-path>");
	}
	return { target, stage, manifestPath };
}

const isEntrypoint = process.argv[1]
	? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
	: false;

if (isEntrypoint) {
	verifyRhinoPackage(parseArguments(process.argv.slice(2))).catch((error) => {
		process.stderr.write(`[hopper-pi] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
