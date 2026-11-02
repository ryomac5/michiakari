import { describe, expect, it } from "vitest";
import { compareReplayOutcome, type ReplayDecision } from "../src/outcome.ts";

const START = "2026-11-05T22:10:00+09:00";

function decide(
  observedAt: string,
  action: ReplayDecision["action"],
  recommendedArrival: string | null,
  waitRideMinutesAfterResume: number | null = 40,
  bestAlternativeArrival: string | null = null,
): ReplayDecision {
  return {
    observedAt,
    action,
    recommendedArrival,
    waitRideMinutesAfterResume,
    bestAlternativeArrival,
  };
}

describe("compareReplayOutcome", () => {
  it("最初の switch で推奨の経路に移り、待ち続けた人は 再開 + 初列車待ち + 乗車分 で着く", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-05T22:10:00+09:00", "hold", null),
        decide("2026-11-05T22:45:00+09:00", "switch", "2026-11-05T23:58:00+09:00"),
        decide("2026-11-05T23:05:00+09:00", "switch", "2026-11-06T00:10:00+09:00"),
      ],
      resumeOffsetMinutes: 90,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: "2026-11-06T00:25:00+09:00",
    });
    expect(outcome).toEqual({
      resumedAt: "2026-11-05T23:40:00+09:00",
      switchedAt: "2026-11-05T22:45:00+09:00",
      followedArrival: "2026-11-05T23:58:00+09:00",
      waitedArrival: "2026-11-06T00:30:00+09:00",
      diffMinutes: 32,
      followedDeadline: { onTime: true, marginMinutes: 27 },
      waitedDeadline: { onTime: false, marginMinutes: -5 },
      firstAlternativeArrival: null,
      alternativeDiffMinutes: null,
      verdict: "followed_earlier",
    });
  });

  it("switch が一度も出なければ、従った人は待った人と同じ時刻に着く", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-06T07:30:00+09:00", "wait", null, 30, "2026-11-06T09:05:00+09:00"),
        decide("2026-11-06T07:45:00+09:00", "wait", null, 32, "2026-11-06T09:10:00+09:00"),
      ],
      resumeOffsetMinutes: 21,
      startTime: "2026-11-06T07:30:00+09:00",
      firstTrainWaitMinutes: 5,
      deadline: "2026-11-06T09:00:00+09:00",
    });
    expect(outcome?.verdict).toBe("never_switched");
    expect(outcome?.switchedAt).toBeNull();
    // 再開 07:51 以前で最後の判断の乗車分 32 を使う
    expect(outcome?.waitedArrival).toBe("2026-11-06T08:28:00+09:00");
    expect(outcome?.followedArrival).toBe(outcome?.waitedArrival);
    expect(outcome?.diffMinutes).toBe(0);
    expect(outcome?.firstAlternativeArrival).toBe("2026-11-06T09:05:00+09:00");
    expect(outcome?.alternativeDiffMinutes).toBe(37);
    expect(outcome?.followedDeadline).toEqual({ onTime: true, marginMinutes: 32 });
  });

  it("期限が無ければ間に合いの判定は null", () => {
    const outcome = compareReplayOutcome({
      decisions: [decide("2026-11-05T18:00:00+09:00", "wait", null, 25)],
      resumeOffsetMinutes: 110,
      startTime: "2026-11-05T18:00:00+09:00",
      firstTrainWaitMinutes: 15,
      deadline: null,
    });
    expect(outcome?.waitedArrival).toBe("2026-11-05T20:30:00+09:00");
    expect(outcome?.followedDeadline).toBeNull();
    expect(outcome?.waitedDeadline).toBeNull();
  });

  it("日付をまたいでも差と期限を正しく求める", () => {
    const outcome = compareReplayOutcome({
      decisions: [decide("2026-11-05T23:50:00+09:00", "switch", "2026-11-06T00:20:00+09:00", 30)],
      resumeOffsetMinutes: 20,
      startTime: "2026-11-05T23:50:00+09:00",
      firstTrainWaitMinutes: 10,
      deadline: "2026-11-06T00:30:00+09:00",
    });
    expect(outcome?.resumedAt).toBe("2026-11-06T00:10:00+09:00");
    expect(outcome?.waitedArrival).toBe("2026-11-06T00:50:00+09:00");
    expect(outcome?.diffMinutes).toBe(30);
    expect(outcome?.followedDeadline).toEqual({ onTime: true, marginMinutes: 10 });
    expect(outcome?.waitedDeadline).toEqual({ onTime: false, marginMinutes: -20 });
  });

  it("切り替えたほうが遅ければ waited_earlier、差が小さければ about_same", () => {
    const base = {
      resumeOffsetMinutes: 30,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    };
    const later = compareReplayOutcome({
      ...base,
      decisions: [decide(START, "switch", "2026-11-05T23:40:00+09:00", 40)],
    });
    expect(later?.diffMinutes).toBe(-10);
    expect(later?.verdict).toBe("waited_earlier");
    const close = compareReplayOutcome({
      ...base,
      decisions: [decide(START, "switch", "2026-11-05T23:27:00+09:00", 40)],
    });
    expect(close?.diffMinutes).toBe(3);
    expect(close?.verdict).toBe("about_same");
  });

  it("再開した後に出た switch は数えない", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide(START, "wait", null, 40),
        decide("2026-11-05T22:40:00+09:00", "switch", "2026-11-05T23:00:00+09:00", 40),
      ],
      resumeOffsetMinutes: 30,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(outcome?.verdict).toBe("never_switched");
  });

  it("正解が無い、または乗車分が記録に無ければ null", () => {
    const base = { startTime: START, firstTrainWaitMinutes: 10, deadline: null };
    expect(
      compareReplayOutcome({
        ...base,
        resumeOffsetMinutes: null,
        decisions: [decide(START, "wait", null)],
      }),
    ).toBeNull();
    expect(
      compareReplayOutcome({
        ...base,
        resumeOffsetMinutes: 30,
        decisions: [decide(START, "wait", null, null)],
      }),
    ).toBeNull();
    expect(compareReplayOutcome({ ...base, resumeOffsetMinutes: 30, decisions: [] })).toBeNull();
  });

  it("初列車待ちが負なら例外", () => {
    expect(() =>
      compareReplayOutcome({
        decisions: [decide(START, "wait", null)],
        resumeOffsetMinutes: 30,
        startTime: START,
        firstTrainWaitMinutes: -1,
        deadline: null,
      }),
    ).toThrow(RangeError);
  });
});
