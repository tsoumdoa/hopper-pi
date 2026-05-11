/**
 * Agent discovery for gh-subagents.
 *
 * Loads agent definitions from the local agents/ directory.
 * Each agent is a .md file with YAML frontmatter (name, description, tools, relevant_tags).
 */

import * as fs from "node:fs";
import * as path from "path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	relevantTags?: string[];
	disableTools: boolean;
	systemPrompt: string;
	filePath: string;
}

const AGENTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "agents");

export function loadAgents(): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(AGENTS_DIR)) return agents;

	const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || !entry.isFile()) continue;

		const filePath = path.join(AGENTS_DIR, entry.name);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

			if (!frontmatter.name || !frontmatter.description) continue;

			// Parse tools — empty/none means explicitly disable all tools
			const rawTools = frontmatter.tools;
			let tools: string[] | undefined;
			let disableTools = false;

			if (rawTools !== undefined && rawTools !== null) {
				const parsed = rawTools
					.split(",")
					.map((t: string) => t.trim())
					.filter(Boolean);
				if (parsed.length === 0 || rawTools.trim() === "none") {
					disableTools = true;
					tools = undefined; // signal to pass --tools none
				} else {
					tools = parsed;
				}
			}
			// if tools frontmatter is omitted entirely → undefined → use pi defaults

			// Parse relevant_tags (comma-separated result tags this agent uses)
			let relevantTags: string[] | undefined;
			if (frontmatter.relevant_tags) {
				relevantTags = frontmatter.relevant_tags
					.split(",")
					.map((t: string) => t.trim())
					.filter(Boolean);
			}

			agents.push({
				name: frontmatter.name,
				description: frontmatter.description,
				tools,
				relevantTags,
				disableTools,
				systemPrompt: body,
				filePath,
			});
		} catch (err) {
			console.warn(`[gh-subagents] Skipping malformed agent file: ${entry.name} — ${(err instanceof Error ? err.message : String(err))}`);
		}
	}

	return agents;
}
