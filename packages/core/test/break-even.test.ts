import { BreakEvenSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  checkDeadline,
  computeBreakEven,
  computeWaitArrival,
  convertToBreakEven,
  selectBestAlternative,
} from "../src/break-even.ts";

const NOW = "2026-11-05T22:00:00+09:00";

const alternatives = [
  { id: "transfer_a", arrivalTime: "2026-11-05T23:10:00+09:00" },
  { id: "transfer_b", arrivalTime: "2026-11-05T23:00:00+09:00" },
];

describe("selectBestAlternative", () => {
  it("到着が最も早いものを返す", () => {
    expect(selectBestAlternative(alternatives)?.id).toBe("transfer_b");
  });

  it("同着なら先に並んだもの", () => {
    const tie = [
      { id: "first", arrivalTime: "2026-11-05T23:00:00+09:00" },
      { id: "second", arrivalTime: "2026-11-05T14:00:00Z" },
    ];
    expect(selectBestAlternative(tie)?.id).toBe("first");
  });

  it("空なら null", () => {
    expect(selectBestAlternative([])).toBeNull();
  });
});

describe("computeWaitArrival", () => {
  it("現在 + 残り + 再開後の乗車時間", () => {
    expect(computeWaitArrival(NOW, 20, 30)).toBe("2026-11-05T22:50:00+09:00");
  });

  it("0 分なら現在時刻", () => {
    expect(computeWaitArrival(NOW, 0, 0)).toBe(NOW);
  });

  it("負の分数は例外", () => {
    expect(() => computeWaitArrival(NOW, -1, 0)).toThrow(RangeError);
    expect(() => computeWaitArrival(NOW, 0, -1)).toThrow(RangeError);
  });
});

describe("computeBreakEven", () => {
  it("境目 = 最良の代替の到着 − 再開後の乗車時間", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 30,
      alternatives,
    });
    expect(result).toEqual({
      kind: "future",
      time: "2026-11-05T22:30:00+09:00",
      minutesFromNow: 30,
      bestAlternativeId: "transfer_b",
      bestAlternativeArrival: "2026-11-05T23:00:00+09:00",
      resumeOutlook: {
        resumeP50: "2026-11-05T22:20:00+09:00",
        resumeP80: "2026-11-05T22:45:00+09:00",
        marginP50Minutes: 10,
        marginP80Minutes: -15,
      },
    });
  });

  it("いま再開しても代替のほうが早いなら passed", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 10, p80: 20 },
      waitRouteMinutesAfterResume: 30,
      alternatives: [{ id: "taxi", arrivalTime: "2026-11-05T22:20:00+09:00" }],
    });
    expect(result).toMatchObject({
      kind: "passed",
      time: "2026-11-05T21:50:00+09:00",
      minutesFromNow: -10,
    });
  });

  it("境目がちょうど現在なら passed、1 分先なら future", () => {
    const base = { now: NOW, remaining: null, waitRouteMinutesAfterResume: 30 };
    const atNow = computeBreakEven({
      ...base,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T22:30:00+09:00" }],
    });
    const oneMinute = computeBreakEven({
      ...base,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T22:31:00+09:00" }],
    });
    expect(atNow).toMatchObject({ kind: "passed", minutesFromNow: 0 });
    expect(oneMinute).toMatchObject({ kind: "future", minutesFromNow: 1 });
  });

  it("再開後の乗車時間が 0 なら境目は代替の到着時刻", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 0,
      alternatives,
    });
    expect(result).toMatchObject({ kind: "future", time: "2026-11-05T23:00:00+09:00" });
  });

  it("日付をまたぐ", () => {
    const result = computeBreakEven({
      now: "2026-11-05T23:50:00+09:00",
      remaining: { p50: 15, p80: 40 },
      waitRouteMinutesAfterResume: 20,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-06T00:40:00+09:00" }],
    });
    expect(result).toMatchObject({
      kind: "future",
      time: "2026-11-06T00:20:00+09:00",
      minutesFromNow: 30,
      resumeOutlook: {
        resumeP50: "2026-11-06T00:05:00+09:00",
        resumeP80: "2026-11-06T00:30:00+09:00",
        marginP50Minutes: 15,
        marginP80Minutes: -10,
      },
    });
  });

  it("代替が無ければ no_alternative", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 30,
      alternatives: [],
    });
    expect(result).toEqual({ kind: "no_alternative" });
  });

  it("残り時間が不明なら resumeOutlook は null", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      alternatives,
    });
    expect(result).toMatchObject({ kind: "future", resumeOutlook: null });
  });

  it("代替の到着が UTC 表記でも +09:00 で返す", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 10,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T14:00:00Z" }],
    });
    expect(result).toMatchObject({
      time: "2026-11-05T22:50:00+09:00",
      bestAlternativeArrival: "2026-11-05T23:00:00+09:00",
    });
  });

  it("再開後の乗車時間が負なら例外", () => {
    expect(() =>
      computeBreakEven({
        now: NOW,
        remaining: null,
        waitRouteMinutesAfterResume: -1,
        alternatives,
      }),
    ).toThrow(RangeError);
  });
});

describe("convertToBreakEven", () => {
  it("BreakEvenSchema に合う形にする", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      alternatives,
    });
    const breakEven = convertToBreakEven(result, "22時30分までに再開しなければ振替が早い");
    expect(breakEven).toEqual({
      time: "2026-11-05T22:30:00+09:00",
      explanation: "22時30分までに再開しなければ振替が早い",
    });
    expect(BreakEvenSchema.safeParse(breakEven).success).toBe(true);
  });

  it("passed も時刻を保って変換する", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      alternatives: [{ id: "taxi", arrivalTime: "2026-11-05T22:20:00+09:00" }],
    });
    expect(convertToBreakEven(result, "すでに過ぎている")?.time).toBe("2026-11-05T21:50:00+09:00");
  });

  it("no_alternative は null", () => {
    expect(convertToBreakEven({ kind: "no_alternative" }, "代替なし")).toBeNull();
  });
});

describe("checkDeadline", () => {
  it("期限ちょうどは間に合う", () => {
    expect(checkDeadline("2026-11-05T23:45:00+09:00", "2026-11-05T23:45:00+09:00")).toEqual({
      onTime: true,
      marginMinutes: 0,
    });
  });

  it("期限より前なら余裕の分を返す", () => {
    expect(checkDeadline("2026-11-05T23:30:00+09:00", "2026-11-05T23:45:00+09:00")).toEqual({
      onTime: true,
      marginMinutes: 15,
    });
  });

  it("1 分遅れなら間に合わない", () => {
    expect(checkDeadline("2026-11-05T23:46:00+09:00", "2026-11-05T23:45:00+09:00")).toEqual({
      onTime: false,
      marginMinutes: -1,
    });
  });

  it("30 秒遅れでも間に合わない", () => {
    expect(checkDeadline("2026-11-05T23:45:30+09:00", "2026-11-05T23:45:00+09:00")).toEqual({
      onTime: false,
      marginMinutes: -1,
    });
  });

  it("日付をまたぐ期限", () => {
    expect(checkDeadline("2026-11-05T23:50:00+09:00", "2026-11-06T00:10:00+09:00")).toEqual({
      onTime: true,
      marginMinutes: 20,
    });
  });
});
