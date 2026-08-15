import type { Observation, Reflection } from "./types.js";
import { workingStateToSummaryLine, type WorkingStateItem } from "./working-state.js";

const CONTEXT_USAGE_INSTRUCTIONS = `These are condensed memories from earlier in this session.

- Reflections: stable, long-lived facts about the user, project, decisions, and constraints. New reflection lines may include ids in brackets.
- Observations: timestamped events from the conversation history, in chronological order. Observation lines include ids in brackets.

Treat these as past records. When entries conflict, the most recent observation reflects the latest known state. Work that prior observations describe as completed should not be redone unless the user explicitly asks to revisit it.

Older records remain in the branch ledger even when they are omitted from this incremental summary. When exact source context is needed for precision or traceability, use the recall tool with a known observation or reflection id. This is especially useful when a reflection materially affects a decision or is too compressed to continue confidently. Do not use recall as broad search or inject raw source unless it is needed.`;

export function observationToSummaryLine(observation: Observation): string {
	return `[${observation.id}] ${observation.timestamp} [${observation.relevance}] ${observation.content}`;
}

export function reflectionToSummaryLine(reflection: Reflection): string {
	return `[${reflection.id}] ${reflection.content}`;
}

export function renderSummary(
	reflections: Reflection[],
	observations: Observation[],
	options: { workingState?: WorkingStateItem[]; hadPriorMemory?: boolean } = {},
): string {
	const workingState = options.workingState ?? [];
	if (reflections.length === 0 && observations.length === 0 && workingState.length === 0 && !options.hadPriorMemory) return "";

	const parts: string[] = [CONTEXT_USAGE_INSTRUCTIONS];
	if (workingState.length > 0) {
		parts.push(`## Working state\n${workingState.map(workingStateToSummaryLine).join("\n")}`);
	}
	if (reflections.length > 0) {
		parts.push(`## Reflections\n${reflections.map(reflectionToSummaryLine).join("\n")}`);
	}
	const stateObservationIds = new Set(workingState.map((item) => item.observation.id));
	const unpinnedObservations = observations.filter((observation) => !stateObservationIds.has(observation.id));
	if (unpinnedObservations.length > 0) {
		parts.push(`## Observations\n${unpinnedObservations.map(observationToSummaryLine).join("\n")}`);
	}
	return parts.join("\n\n");
}
