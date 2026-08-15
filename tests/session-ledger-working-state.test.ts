import { describe, expect, it } from "vitest";
import { foldWorkingState } from "../src/session-ledger/index.js";
import { observation, observationsDroppedEntry, observationsRecordedEntry, textCustomMessage } from "./fixtures/session.js";

function stateObservation(
	id: string,
	slot: "branch" | "worktree" | "pull_request" | "verification" | "decision" | "blocker" | "next_action",
	key: string,
	status: "active" | "resolved" = "active",
) {
	return observation(id, { content: `${slot} ${key} ${status}`, workingState: { slot, key, status } });
}

describe("working-state folding", () => {
	it("uses latest singleton and keyed collection state, and removes resolutions", () => {
		const entries = [
			textCustomMessage("raw-1", "one"),
			observationsRecordedEntry("om-1", { observations: [
				stateObservation("aaaaaaaaaaaa", "branch", "old"),
				stateObservation("bbbbbbbbbbbb", "blocker", "ci"),
			], coversUpToId: "raw-1" }),
			textCustomMessage("raw-2", "two"),
			observationsRecordedEntry("om-2", { observations: [
				stateObservation("cccccccccccc", "branch", "current"),
				stateObservation("dddddddddddd", "blocker", "ci", "resolved"),
			], coversUpToId: "raw-2" }),
		];

		expect(foldWorkingState(entries, "raw-2").map((item) => item.observation.id)).toEqual(["cccccccccccc"]);
	});

	it("caps collections and keeps pinned state even after its observation is dropped", () => {
		const blockers = ["111111111111", "222222222222", "333333333333", "444444444444"]
			.map((id, index) => stateObservation(id, "blocker", `b${index}`));
		const entries = [
			textCustomMessage("raw-1", "one"),
			observationsRecordedEntry("om-1", { observations: blockers, coversUpToId: "raw-1" }),
			observationsDroppedEntry("drop-1", { observationIds: ["444444444444"], coversUpToId: "raw-1" }),
		];

		expect(foldWorkingState(entries, "raw-1").map((item) => item.observation.id)).toEqual([
			"222222222222", "333333333333", "444444444444",
		]);
	});
});
