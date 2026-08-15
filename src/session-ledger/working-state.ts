import { isObservationsRecordedEntry, type Entry, type Observation, type WorkingStateSlot } from "./types.js";

const SINGLETON_SLOTS = new Set<WorkingStateSlot>(["branch", "worktree", "pull_request", "next_action"]);
const COLLECTION_CAP = 3;

export type WorkingStateItem = {
	slot: WorkingStateSlot;
	key: string;
	observation: Observation;
};

/** Fold state annotations by coverage while retaining dropped source records. */
export function foldWorkingState(entries: Entry[], upToEntryId: string): WorkingStateItem[] {
	const indexes = new Map(entries.map((entry, index) => [entry.id, index]));
	const boundary = indexes.get(upToEntryId);
	if (boundary === undefined) return [];
	const firstValid = new Set<string>();
	const active = new Map<string, WorkingStateItem>();

	for (const entry of entries) {
		if (!isObservationsRecordedEntry(entry)) continue;
		const coverage = indexes.get(entry.data.coversUpToId);
		if (coverage === undefined || coverage > boundary) continue;
		for (const observation of entry.data.observations) {
			if (firstValid.has(observation.id)) continue;
			firstValid.add(observation.id);
			const state = observation.workingState;
			if (!state) continue;
			const identity = SINGLETON_SLOTS.has(state.slot) ? state.slot : `${state.slot}:${state.key}`;
			active.delete(identity);
			if (state.status === "active") {
				active.set(identity, { slot: state.slot, key: state.key, observation });
			}
		}
	}

	const items = [...active.values()];
	const result: WorkingStateItem[] = [];
	for (const slot of ["branch", "worktree", "pull_request", "verification", "decision", "blocker", "next_action"] as const) {
		const matches = items.filter((item) => item.slot === slot);
		result.push(...(SINGLETON_SLOTS.has(slot) ? matches.slice(-1) : matches.slice(-COLLECTION_CAP)));
	}
	return result;
}

export function workingStateToSummaryLine(item: WorkingStateItem): string {
	return `- ${item.slot}/${item.key}: ${item.observation.content} [${item.observation.id}]`;
}
