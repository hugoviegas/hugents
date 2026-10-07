import { describe, expect, it } from "vitest";
import { POPUP_STATES, POPUP_TEXT, canOpenPopup, popupState, shouldShowFrame } from "../src/popup.js";

const base = { relayReachable: true, streamOpen: true, run: { runId: "r" } };

describe("popup", () => {
  it("opens only for an agent with an active run", () => {
    expect(canOpenPopup({ id: "player-alpha" }, { agentId: "player-alpha" })).toBe(true);
    expect(canOpenPopup({ id: "explorer" }, { agentId: "player-alpha" })).toBe(false);
    expect(canOpenPopup({ id: "player-alpha" }, null)).toBe(false);
  });
  it("derives every state", () => {
    expect(popupState({ ...base, relayReachable: false })).toBe("relay-offline");
    expect(popupState({ ...base, run: null })).toBe("no-active-run");
    expect(popupState({ ...base, run: null, endedWhileOpen: true })).toBe("run-ended");
    expect(popupState({ ...base, streamOpen: false })).toBe("connecting");
    expect(popupState(base)).toBe("connecting");
    expect(popupState({ ...base, frame: { gate: "visible", ageMs: 100 } })).toBe("live");
    expect(popupState({ ...base, frame: { gate: "visible", ageMs: 9000 } })).toBe("slow");
    expect(popupState({ ...base, frame: { gate: "hidden", ageMs: 100 } })).toBe("hidden-by-gate");
  });
  it("has visible text for each state and shows frames only when live or slow", () => {
    for (const s of POPUP_STATES) expect(POPUP_TEXT[s].length).toBeGreaterThan(3);
    expect(shouldShowFrame("live", { paused: false, hidden: false })).toBe(true);
    expect(shouldShowFrame("live", { paused: true, hidden: false })).toBe(false);
    expect(shouldShowFrame("run-ended", { paused: false, hidden: false })).toBe(false);
    expect(shouldShowFrame("hidden-by-gate", { paused: false, hidden: false })).toBe(false);
  });
});
