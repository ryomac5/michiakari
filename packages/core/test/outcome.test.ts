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
      followed: {
        switchedAt: "2026-11-05T22:45:00+09:00",
        arrival: "2026-11-05T23:58:00+09:00",
        deadline: { onTime: true, marginMinutes: 27 },
      },
      counterpart: {
        switchedAt: null,
        arrival: "2026-11-06T00:30:00+09:00",
        deadline: { onTime: false, marginMinutes: -5 },
      },
      diffMinutes: 32,
      verdict: "followed_earlier",
    });
  });

  it("切り替え、待つ、切り替えと変わっても、最初に切り替えを勧めた時点で移り、待つの判断では戻らない", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-05T22:10:00+09:00", "switch", "2026-11-05T23:25:00+09:00"),
        decide("2026-11-05T22:18:00+09:00", "switch", "2026-11-05T23:30:00+09:00"),
        decide("2026-11-05T22:32:00+09:00", "wait", "2026-11-06T00:05:00+09:00"),
        decide("2026-11-05T22:45:00+09:00", "switch", "2026-11-05T23:58:00+09:00"),
        decide("2026-11-05T23:05:00+09:00", "switch", "2026-11-06T00:15:00+09:00"),
        decide("2026-11-05T23:35:00+09:00", "wait", "2026-11-06T00:30:00+09:00"),
      ],
      resumeOffsetMinutes: 90,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: "2026-11-06T00:25:00+09:00",
    });
    // 22:10 の判断のおすすめの経路で 23:25 に着く。待ち続けた人は 23:40 + 10 + 40 = 00:30
    expect(outcome?.followed).toEqual({
      switchedAt: "2026-11-05T22:10:00+09:00",
      arrival: "2026-11-05T23:25:00+09:00",
      deadline: { onTime: true, marginMinutes: 60 },
    });
    expect(outcome?.counterpart.switchedAt).toBeNull();
    expect(outcome?.counterpart.arrival).toBe("2026-11-06T00:30:00+09:00");
    expect(outcome?.diffMinutes).toBe(65);
    expect(outcome?.verdict).toBe("followed_earlier");
  });

  it("切り替えるだけが続けば、最初の切り替えの判断のおすすめの経路で着く", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-05T22:10:00+09:00", "switch", "2026-11-05T23:20:00+09:00"),
        decide("2026-11-05T22:25:00+09:00", "switch", "2026-11-05T23:35:00+09:00"),
        decide("2026-11-05T22:40:00+09:00", "switch", "2026-11-05T23:50:00+09:00"),
      ],
      resumeOffsetMinutes: 90,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(outcome?.followed).toEqual({
      switchedAt: "2026-11-05T22:10:00+09:00",
      arrival: "2026-11-05T23:20:00+09:00",
      deadline: null,
    });
    expect(outcome?.counterpart.switchedAt).toBeNull();
    expect(outcome?.diffMinutes).toBe(70);
  });

  it("待つだけが続けば、従った人は再開を待って乗り、最初の観測で切り替えた人と比べる", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-05T22:10:00+09:00", "wait", null, 40, "2026-11-05T23:10:00+09:00"),
        decide("2026-11-05T22:25:00+09:00", "wait", null, 40, "2026-11-05T23:20:00+09:00"),
        decide("2026-11-05T22:40:00+09:00", "wait", null, 40, "2026-11-05T23:30:00+09:00"),
      ],
      resumeOffsetMinutes: 50,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    // 再開 23:00 + 初列車待ち 10 + 乗車 40 = 23:50
    expect(outcome?.followed).toEqual({
      switchedAt: null,
      arrival: "2026-11-05T23:50:00+09:00",
      deadline: null,
    });
    expect(outcome?.counterpart).toEqual({
      switchedAt: "2026-11-05T22:10:00+09:00",
      arrival: "2026-11-05T23:10:00+09:00",
      deadline: null,
    });
    expect(outcome?.diffMinutes).toBe(-40);
    expect(outcome?.verdict).toBe("counterpart_earlier");
  });

  it("switch が一度も出なければ、待ち続けた従った人を、最初の観測で切り替えた人と比べる", () => {
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
    // 再開 07:51 以前で最後の判断の乗車分 32 を使う
    expect(outcome?.followed).toEqual({
      switchedAt: null,
      arrival: "2026-11-06T08:28:00+09:00",
      deadline: { onTime: true, marginMinutes: 32 },
    });
    // 比べる相手は、最初の観測 07:30 で最も早い代替手段に移った人
    expect(outcome?.counterpart).toEqual({
      switchedAt: "2026-11-06T07:30:00+09:00",
      arrival: "2026-11-06T09:05:00+09:00",
      deadline: { onTime: false, marginMinutes: -5 },
    });
    expect(outcome?.diffMinutes).toBe(37);
    expect(outcome?.verdict).toBe("followed_earlier");
  });

  it("差は並べる 2 人の到着の差と一致し、相手と従った人の時刻は差があれば異なる", () => {
    const outcome = compareReplayOutcome({
      decisions: [
        decide("2026-11-09T18:20:00+09:00", "wait", null, 14, "2026-11-09T18:50:00+09:00"),
        decide("2026-11-09T18:27:00+09:00", "wait", null, 14, "2026-11-09T18:55:00+09:00"),
      ],
      resumeOffsetMinutes: 7,
      startTime: "2026-11-09T18:20:00+09:00",
      firstTrainWaitMinutes: 0,
      deadline: null,
    });
    if (!outcome) throw new Error("結末がありません");
    expect(outcome.followed.arrival).toBe("2026-11-09T18:41:00+09:00");
    expect(outcome.counterpart.arrival).toBe("2026-11-09T18:50:00+09:00");
    expect(outcome.followed.arrival).not.toBe(outcome.counterpart.arrival);
    expect(outcome.diffMinutes).toBe(
      (Date.parse(outcome.counterpart.arrival) - Date.parse(outcome.followed.arrival)) / 60_000,
    );
  });

  it("待つ判断で、最初に切り替えたほうが早ければ counterpart_earlier", () => {
    const outcome = compareReplayOutcome({
      decisions: [decide(START, "wait", null, 40, "2026-11-05T22:50:00+09:00")],
      resumeOffsetMinutes: 60,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(outcome?.followed.arrival).toBe("2026-11-06T00:00:00+09:00");
    expect(outcome?.counterpart.switchedAt).toBe(START);
    expect(outcome?.diffMinutes).toBe(-70);
    expect(outcome?.verdict).toBe("counterpart_earlier");
  });

  it("待つ判断で代替手段が無ければ、相手は待ち続けた人で従った人と同じになる", () => {
    const outcome = compareReplayOutcome({
      decisions: [decide(START, "wait", null, 40)],
      resumeOffsetMinutes: 30,
      startTime: START,
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(outcome?.counterpart).toEqual(outcome?.followed);
    expect(outcome?.counterpart.switchedAt).toBeNull();
    expect(outcome?.diffMinutes).toBe(0);
    expect(outcome?.verdict).toBe("about_same");
  });

  it("期限が無ければ間に合いの判定は null", () => {
    const outcome = compareReplayOutcome({
      decisions: [decide("2026-11-05T18:00:00+09:00", "wait", null, 25)],
      resumeOffsetMinutes: 110,
      startTime: "2026-11-05T18:00:00+09:00",
      firstTrainWaitMinutes: 15,
      deadline: null,
    });
    expect(outcome?.followed.arrival).toBe("2026-11-05T20:30:00+09:00");
    expect(outcome?.followed.deadline).toBeNull();
    expect(outcome?.counterpart.deadline).toBeNull();
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
    expect(outcome?.counterpart.arrival).toBe("2026-11-06T00:50:00+09:00");
    expect(outcome?.diffMinutes).toBe(30);
    expect(outcome?.followed.deadline).toEqual({ onTime: true, marginMinutes: 10 });
    expect(outcome?.counterpart.deadline).toEqual({ onTime: false, marginMinutes: -20 });
  });

  it("切り替えたほうが遅ければ counterpart_earlier、差が小さければ about_same", () => {
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
    expect(later?.verdict).toBe("counterpart_earlier");
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
    expect(outcome?.followed.switchedAt).toBeNull();
    expect(outcome?.counterpart.switchedAt).toBeNull();
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
