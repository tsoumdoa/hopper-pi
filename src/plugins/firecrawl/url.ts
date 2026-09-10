import { isIP } from "node:net";

function publicV4(host: string): boolean {
	const [a, b, c] = host.split(".").map(Number);
	return !(a === 0 || a === 10 || a === 127 || a >= 224
		|| (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
		|| (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
		|| (a === 203 && b === 0 && c === 113));
}

function publicV6(host: string): boolean {
	const halves = host.split("::");
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves[1] ? halves[1].split(":") : [];
	const words = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right].map(x => parseInt(x, 16));
	if (words.slice(0, 5).every(x => x === 0) && words[5] === 0xffff) {
		return publicV4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
	}
	// Only globally routed unicast; exclude documentation, transition and reserved allocations.
	return words[0] >= 0x2000 && words[0] <= 0x3fff
		&& !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8))
		&& words[0] !== 0x2002 && words[0] !== 0x3ffe && !(words[0] === 0x3fff && words[1] <= 0x0fff);
}

/** Input validation only. DNS resolution and redirects happen at Firecrawl. */
export function canonicalPublicUrl(input: string): string {
	if (typeof input !== "string" || input.length > 8192 || /[\u0000-\u0020\u007f]/.test(input)) throw new Error("invalid-url");
	let url: URL;
	try { url = new URL(input); } catch { throw new Error("invalid-url"); }
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("invalid-url");
	const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
	const ip = isIP(host);
	if (ip ? !(ip === 4 ? publicV4(host) : publicV6(host))
		: host.length > 253 || !host.includes(".") || /(^|\.)(localhost|local|internal|home|lan|test|invalid|onion|home\.arpa)$/.test(host)
			|| !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
		throw new Error("invalid-url");
	}
	url.hash = "";
	if (url.href.length > 8192) throw new Error("invalid-url");
	return url.href;
}

export function domainFilters(input: unknown): string[] | undefined {
	if (input === undefined) return undefined;
	if (!Array.isArray(input) || input.length > 20) throw new Error("invalid-domains");
	return [...new Set(input.map(value => {
		if (typeof value !== "string" || /[/:@?#%\\\s]/.test(value)) throw new Error("invalid-domains");
		const url = new URL(canonicalPublicUrl(`https://${value}`));
		if (isIP(url.hostname)) throw new Error("invalid-domains");
		return url.hostname.replace(/\.$/, "");
	}))];
}
