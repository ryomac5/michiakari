import { BreakEvenSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { FIRST_TRAIN_WAIT_BY_STOP_KIND } from "../params/incident-behavior.ts";
import {
  checkDeadline,
  computeBreakEven,
  computeLateShare,
  computeWaitArrival,
  convertToBreakEven,
  selectBestAlternative,
} from "../src/break-even.ts";
import { resolveFirstTrainWait } from "../src/incident-rules.ts";
import { sampleDurationDist, summarizeSamples } from "../src/remaining.ts";
import { addMinutesToIso, diffMinutes } from "../src/time.ts";

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
  it("例: 残り {20,35}・初列車待ち 10・W=30・代替 23:00 なら再開の期限は 22:20", () => {
    const firstTrainWaitMinutes = 10;
    const remaining = summarizeSamples(sampleDurationDist({ p50: 20, p80: 35 }));
    const result = computeBreakEven({
      now: NOW,
      remaining,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes,
      alternatives: [{ id: "transfer", arrivalTime: "2026-11-05T23:00:00+09:00" }],
    });
    expect(firstTrainWaitMinutes).toBe(10);
    expect(result).toMatchObject({
      kind: "future",
      time: "2026-11-05T22:20:00+09:00",
      minutesFromNow: 20,
      bestAlternativeId: "transfer",
      resumeOutlook: {
        resumeP50: addMinutesToIso(NOW, remaining.p50 - 10),
        resumeP80: addMinutesToIso(NOW, remaining.p80 - 10),
        // 乗れる期限 22:30 − 乗れる見込み（現在 + 残り）
        marginP50Minutes: 30 - remaining.p50,
        marginP80Minutes: 30 - remaining.p80,
      },
    });
  });

  it("境目 = 最良の代替の到着 − 再開後の乗車時間 − 初列車待ち", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 20, p80: 45 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 10,
      alternatives,
    });
    expect(result).toEqual({
      kind: "future",
      time: "2026-11-05T22:20:00+09:00",
      minutesFromNow: 20,
      bestAlternativeId: "transfer_b",
      bestAlternativeArrival: "2026-11-05T23:00:00+09:00",
      resumeOutlook: {
        resumeP50: "2026-11-05T22:10:00+09:00",
        resumeP80: "2026-11-05T22:35:00+09:00",
        marginP50Minutes: 10,
        marginP80Minutes: -15,
      },
    });
  });

  it("境目ちょうどに再開すると、待つ場合の到着は最良の代替と同時刻", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 10,
      alternatives,
    });
    if (result.kind === "no_alternative") throw new Error("代替があるはず");
    expect(computeWaitArrival(result.time, 10, 30)).toBe(result.bestAlternativeArrival);
  });

  it("margin は 境目 − 再開見込み と一致する", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 25, p80: 50 },
      waitRouteMinutesAfterResume: 20,
      firstTrainWaitMinutes: 8,
      alternatives,
    });
    if (result.kind === "no_alternative" || result.resumeOutlook === null) {
      throw new Error("見込みがあるはず");
    }
    const { resumeP50, resumeP80, marginP50Minutes, marginP80Minutes } = result.resumeOutlook;
    expect(marginP50Minutes).toBe(diffMinutes(resumeP50, result.time));
    expect(marginP80Minutes).toBe(diffMinutes(resumeP80, result.time));
  });

  it("残りが初列車待ちより短くても再開見込みは現在より前にならない", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 3, p80: 8 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives,
    });
    expect(result).toMatchObject({
      time: "2026-11-05T22:25:00+09:00",
      resumeOutlook: {
        resumeP50: NOW,
        resumeP80: "2026-11-05T22:03:00+09:00",
        marginP50Minutes: 27,
        marginP80Minutes: 22,
      },
    });
  });

  it("いま再開しても代替のほうが早いなら passed", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: { p50: 10, p80: 20 },
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives: [{ id: "taxi", arrivalTime: "2026-11-05T22:20:00+09:00" }],
    });
    expect(result).toMatchObject({
      kind: "passed",
      time: "2026-11-05T21:45:00+09:00",
      minutesFromNow: -15,
    });
  });

  it("境目がちょうど現在なら passed、1 分先なら future", () => {
    const base = {
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 10,
    };
    const atNow = computeBreakEven({
      ...base,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T22:40:00+09:00" }],
    });
    const oneMinute = computeBreakEven({
      ...base,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T22:41:00+09:00" }],
    });
    expect(atNow).toMatchObject({ kind: "passed", time: NOW, minutesFromNow: 0 });
    expect(oneMinute).toMatchObject({ kind: "future", minutesFromNow: 1 });
  });

  it("再開後の乗車時間と初列車待ちが 0 なら境目は代替の到着時刻", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 0,
      firstTrainWaitMinutes: 0,
      alternatives,
    });
    expect(result).toMatchObject({ kind: "future", time: "2026-11-05T23:00:00+09:00" });
  });

  it("初列車待ちだけでも境目を前に倒す", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 0,
      firstTrainWaitMinutes: 10,
      alternatives,
    });
    expect(result).toMatchObject({ kind: "future", time: "2026-11-05T22:50:00+09:00" });
  });

  it("日付をまたぐ", () => {
    const result = computeBreakEven({
      now: "2026-11-05T23:50:00+09:00",
      remaining: { p50: 15, p80: 40 },
      waitRouteMinutesAfterResume: 20,
      firstTrainWaitMinutes: 5,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-06T00:40:00+09:00" }],
    });
    expect(result).toMatchObject({
      kind: "future",
      time: "2026-11-06T00:15:00+09:00",
      minutesFromNow: 25,
      resumeOutlook: {
        resumeP50: "2026-11-06T00:00:00+09:00",
        resumeP80: "2026-11-06T00:25:00+09:00",
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
      firstTrainWaitMinutes: 10,
      alternatives: [],
    });
    expect(result).toEqual({ kind: "no_alternative" });
  });

  it("残り時間が不明なら resumeOutlook は null", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 10,
      alternatives,
    });
    expect(result).toMatchObject({ kind: "future", resumeOutlook: null });
  });

  it("代替の到着が UTC 表記でも +09:00 で返す", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 10,
      firstTrainWaitMinutes: 5,
      alternatives: [{ id: "alt", arrivalTime: "2026-11-05T14:00:00Z" }],
    });
    expect(result).toMatchObject({
      time: "2026-11-05T22:45:00+09:00",
      bestAlternativeArrival: "2026-11-05T23:00:00+09:00",
    });
  });

  it("再開後の乗車時間か初列車待ちが負なら例外", () => {
    const base = { now: NOW, remaining: null, alternatives };
    expect(() =>
      computeBreakEven({ ...base, waitRouteMinutesAfterResume: -1, firstTrainWaitMinutes: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      computeBreakEven({ ...base, waitRouteMinutesAfterResume: 0, firstTrainWaitMinutes: -1 }),
    ).toThrow(RangeError);
  });
});

describe("resolveFirstTrainWait", () => {
  it("事象の種類の止まり方から初列車待ちを引き、種類が分からなければ区間で止まる値にする", () => {
    expect(resolveFirstTrainWait("heavy_rain")).toEqual(FIRST_TRAIN_WAIT_BY_STOP_KIND.section);
    expect(resolveFirstTrainWait(null)).toEqual(FIRST_TRAIN_WAIT_BY_STOP_KIND.section);
  });
});

describe("convertToBreakEven", () => {
  it("BreakEvenSchema に合う形にする", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 10,
      alternatives,
    });
    const breakEven = convertToBreakEven(result, "22時20分までに再開しなければ振替が早い");
    expect(breakEven).toEqual({
      time: "2026-11-05T22:20:00+09:00",
      explanation: "22時20分までに再開しなければ振替が早い",
    });
    expect(BreakEvenSchema.safeParse(breakEven).success).toBe(true);
  });

  it("passed も時刻を保って変換する", () => {
    const result = computeBreakEven({
      now: NOW,
      remaining: null,
      waitRouteMinutesAfterResume: 30,
      firstTrainWaitMinutes: 5,
      alternatives: [{ id: "taxi", arrivalTime: "2026-11-05T22:20:00+09:00" }],
    });
    expect(convertToBreakEven(result, "すでに過ぎている")?.time).toBe("2026-11-05T21:45:00+09:00");
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

describe("computeLateShare", () => {
  it("p50 が分岐点より後なら 1、p80 が分岐点以前なら 0", () => {
    expect(computeLateShare({ marginP50Minutes: -43, marginP80Minutes: -118 })).toBe(1);
    expect(computeLateShare({ marginP50Minutes: 20, marginP80Minutes: 0 })).toBe(0);
  });

  it("分岐点が幅の中にあれば、後ろにある割合を返す", () => {
    expect(computeLateShare({ marginP50Minutes: 10, marginP80Minutes: -30 })).toBe(0.75);
    expect(computeLateShare({ marginP50Minutes: 0, marginP80Minutes: -20 })).toBe(1);
  });
});
