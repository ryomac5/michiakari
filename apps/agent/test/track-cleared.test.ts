import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { checkTrackCleared } from "../src/domain/phase.ts";

// 線路の安全が確かめられた兆候。再開の見込みの時刻か、再開が近いと言い切る放送だけを数える

function buildObservation(overrides: Partial<Observation>): Observation {
  return {
    id: "obs",
    observedAt: "2026-11-05T22:00:00+09:00",
    source: "text",
    eventTypeCandidates: [],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
    ...overrides,
  };
}

describe("checkTrackCleared", () => {
  it("再開の見込みの時刻が出たら、安全が確かめられたとみなす", () => {
    expect(
      checkTrackCleared([buildObservation({ statedResumeTime: "2026-11-05T22:30:00+09:00" })]),
    ).toBe(true);
  });

  it("まもなく再開する放送や、順次再開する放送は、安全が確かめられた兆候とする", () => {
    expect(checkTrackCleared([buildObservation({ rawText: "まもなく運転を再開します" })])).toBe(
      true,
    );
    expect(
      checkTrackCleared([
        buildObservation({
          detectedSignals: [
            {
              eventType: "x",
              signalId: "s",
              quote: "安全が確認できましたので、順次運転を再開します",
            },
          ],
        }),
      ]),
    ).toBe(true);
  });

  it("線路の点検中や、点検が終わり次第の再開は、まだ安全が確かめられていない", () => {
    expect(
      checkTrackCleared([
        buildObservation({ rawText: "雨が弱まったため、線路の点検を行っています" }),
        buildObservation({ rawText: "点検が終わり次第、運転を再開します" }),
        buildObservation({ rawText: "安全を確認でき次第、運転を再開します" }),
      ]),
    ).toBe(false);
    expect(checkTrackCleared([])).toBe(false);
  });
});
