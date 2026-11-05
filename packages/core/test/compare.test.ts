import { describe, expect, it } from "vitest";
import { computeBreakEven } from "../src/break-even.ts";
import { compareOptions } from "../src/compare.ts";

const NOW = "2026-11-05T22:00:00+09:00";

const alternatives = [
  { id: "transfer_a", arrivalTime: "2026-11-05T23:10:00+09:00" },
  { id: "taxi", arrivalTime: "2026-11-05T22:40:00+09:00" },
];

describe("compareOptions", () => {
  it("待つ場合（p50・p80）と代替を到着の早い順に並べる", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives,
      deadline: "2026-11-05T23:00:00+09:00",
    });
    expect(rows).toEqual([
      {
        optionId: "taxi",
        scenario: "alternative",
        arrivalTime: "2026-11-05T22:40:00+09:00",
        minutesFromNow: 40,
        deadline: { onTime: true, marginMinutes: 20 },
      },
      {
        optionId: "wait",
        scenario: "wait_p50",
        arrivalTime: "2026-11-05T22:50:00+09:00",
        minutesFromNow: 50,
        deadline: { onTime: true, marginMinutes: 10 },
      },
      {
        optionId: "transfer_a",
        scenario: "alternative",
        arrivalTime: "2026-11-05T23:10:00+09:00",
        minutesFromNow: 70,
        deadline: { onTime: false, marginMinutes: -10 },
      },
      {
        optionId: "wait",
        scenario: "wait_p80",
        arrivalTime: "2026-11-05T23:15:00+09:00",
        minutesFromNow: 75,
        deadline: { onTime: false, marginMinutes: -15 },
      },
    ]);
  });

  it("期限がなければ deadline は null", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives,
      deadline: null,
    });
    expect(rows.every((r) => r.deadline === null)).toBe(true);
  });

  it("残り時間が不明なら代替だけを並べる", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives,
      deadline: null,
    });
    expect(rows.map((r) => r.optionId)).toEqual(["taxi", "transfer_a"]);
  });

  it("代替が無ければ待つ場合だけを並べる", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: { p50: 0, p80: 0 },
      waitRouteMinutesAfterResume: 0,
      firstTrainWaitMinutes: 0,
      alternatives: [],
      deadline: null,
    });
    expect(rows.map((r) => [r.scenario, r.arrivalTime])).toEqual([
      ["wait_p50", NOW],
      ["wait_p80", NOW],
    ]);
  });

  it("同着は待つ場合を先に、代替は入力順に並べる", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: { p50: 10, p80: 10 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives: [
        { id: "second", arrivalTime: "2026-11-05T22:40:00+09:00" },
        { id: "third", arrivalTime: "2026-11-05T13:40:00Z" },
      ],
      deadline: null,
    });
    expect(rows.map((r) => `${r.optionId}:${r.scenario}`)).toEqual([
      "wait:wait_p50",
      "wait:wait_p80",
      "second:alternative",
      "third:alternative",
    ]);
    expect(rows[3]?.arrivalTime).toBe("2026-11-05T22:40:00+09:00");
  });

  it("待つ場合の ID を指定できる", () => {
    const rows = compareOptions({
      now: NOW,
      remaining: { p50: 5, p80: 10 },
      waitRouteMinutesAfterResume: 10,
      firstTrainWaitMinutes: 5,
      alternatives: [],
      deadline: null,
      waitOptionId: "wait_resume",
    });
    expect(rows.every((r) => r.optionId === "wait_resume")).toBe(true);
  });

  it("日付をまたぐ", () => {
    const rows = compareOptions({
      now: "2026-11-05T23:50:00+09:00",
      remaining: { p50: 15, p80: 40 },
      waitRouteMinutesAfterResume: 20,
      firstTrainWaitMinutes: 5,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-06T00:40:00+09:00" }],
      deadline: "2026-11-06T00:30:00+09:00",
    });
    expect(rows.map((r) => [r.optionId, r.arrivalTime, r.deadline?.onTime])).toEqual([
      ["wait", "2026-11-06T00:25:00+09:00", true],
      ["alt", "2026-11-06T00:40:00+09:00", false],
      ["wait", "2026-11-06T00:50:00+09:00", false],
    ]);
  });

  it("待つ場合の p50 が分岐点より前に再開する見込みなら、最良の代替より早く着く", () => {
    const input = {
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 10,
      firstTrainWaitMinutes: 5,
      alternatives,
      deadline: null,
    };
    const breakEven = computeBreakEven(input);
    const rows = compareOptions(input);
    if (breakEven.kind === "no_alternative" || breakEven.resumeOutlook === null) {
      throw new Error("見込みがあるはず");
    }
    expect(breakEven.resumeOutlook.marginP50Minutes).toBeGreaterThan(0);
    expect(rows[0]?.scenario).toBe("wait_p50");
  });

  it("初列車待ちが負なら例外", () => {
    expect(() =>
      compareOptions({
        now: NOW,
        remaining: { p50: 20, p80: 45 },
        waitRouteMinutesAfterResume: 10,
        firstTrainWaitMinutes: -1,
        alternatives,
        deadline: null,
      }),
    ).toThrow(RangeError);
  });
});
