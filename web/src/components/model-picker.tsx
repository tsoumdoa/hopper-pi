import { Brain, KeyRound } from "lucide-react";
import { useMemo } from "react";
import { providerLabel, thinkingLabel } from "../lib/utils";
import type { HopperState } from "../state/hopper-types";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "./ui/select";

const MANAGE = "__manage-providers__";

/** Compact trigger used inside the composer toolbar. */
export const toolbarTriggerClass =
	"h-7 w-auto max-w-[220px] gap-1.5 border-transparent bg-transparent px-2 text-xs font-medium text-ink-soft hover:border-transparent hover:bg-ink/[.06] hover:text-ink data-[placeholder]:text-muted";

export type ModelControlsProps = {
	state: HopperState;
	connected: boolean;
	onSelectModel(value: string): void;
	onSelectThinking(level: string): void;
	onManageProvider(): void;
};

export function ModelControls({ state, connected, onSelectModel, onSelectThinking, onManageProvider }: ModelControlsProps) {
	const groupedModels = useMemo(() => {
		const groups = new Map<string, HopperState["models"]>();
		for (const model of state.models) {
			const list = groups.get(model.provider) ?? [];
			list.push(model);
			groups.set(model.provider, list);
		}
		return [...groups.entries()];
	}, [state.models]);

	if (connected && !state.models.length) {
		return (
			<Button size="sm" variant="ghost" className="text-accent hover:text-accent" onClick={onManageProvider}>
				<KeyRound className="size-3.5" />
				Connect a provider
			</Button>
		);
	}

	const modelValue = state.selectedModel ? `${state.selectedModel.provider}/${state.selectedModel.id}` : "";
	const showThinking = state.availableThinkingLevels.length > 1;

	return (
		<>
			<Select
				disabled={!connected}
				value={modelValue}
				onValueChange={(value) => {
					if (value === MANAGE) onManageProvider();
					else onSelectModel(value);
				}}
			>
				<SelectTrigger aria-label="Model" className={toolbarTriggerClass}>
					<SelectValue placeholder="Waiting for models" />
				</SelectTrigger>
				<SelectContent align="start">
					{groupedModels.map(([provider, models]) => (
						<SelectGroup key={provider}>
							<SelectLabel>{providerLabel(provider, state.providers)}</SelectLabel>
							{models.map((model) => (
								<SelectItem key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
									{model.name ?? model.id}
								</SelectItem>
							))}
						</SelectGroup>
					))}
					<SelectSeparator />
					<SelectItem value={MANAGE} className="text-ink-soft">Manage providers…</SelectItem>
				</SelectContent>
			</Select>
			{showThinking && (
				<Select disabled={!connected} value={state.thinkingLevel} onValueChange={onSelectThinking}>
					<SelectTrigger aria-label="Thinking level" className={toolbarTriggerClass}>
						<Brain className="size-3.5 shrink-0 text-muted" />
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="start">
						{state.availableThinkingLevels.map((level) => (
							<SelectItem key={level} value={level}>{thinkingLabel(level)}</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</>
	);
}
