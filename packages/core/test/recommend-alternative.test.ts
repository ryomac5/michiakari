import { describe, expect, it } from "vitest";
import { ACCESS_WALK_MAX_MINUTES, ACCESS_WALK_MAX_MINUTES_EXTENDED } from "../params/routing.ts";
import {
  chooseBestAlternative,
  computeBreakEven,
  computeWaitArrival,
  selectBestAlternative,
} from "../src/break-even.ts";

// 勧める代替手段の決まり。タクシーは、鉄道の代替が無いときと、鉄道の代替では期限に間に合わないときだけ勧める

const NOW = "2026-11-05T22:00:00+09:00";

const rail = (id: string, arrivalTime: string) => ({ id, kind: "transfer" as const, arrivalTime });
const taxi = (arrivalTime: string) => ({ id: "taxi", kind: "taxi" as const, arrivalTime });
const walk = (arrivalTime: string) => ({ id: "walk", kind: "walk" as const, arrivalTime });

describe("selectBestAlternative: 鉄道の代替がある", () => {
  it("期限が無ければ、タクシーのほうが早くても鉄道の代替のうちいちばん早いものを勧める", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:40:00+09:00"),
      rail("transfer_2", "2026-11-05T23:30:00+09:00"),
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(selectBestAlternative(options)?.id).toBe("transfer_2");
    expect(selectBestAlternative(options, null)?.id).toBe("transfer_2");
  });

  it("鉄道の代替が期限に間に合うなら、タクシーのほうが早くても鉄道の代替を勧める", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:30:00+09:00"),
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(selectBestAlternative(options, "2026-11-05T23:40:00+09:00")?.id).toBe("transfer_1");
  });

  it("期限ちょうどの到着は間に合うので、鉄道の代替を勧める", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:30:00+09:00"),
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(selectBestAlternative(options, "2026-11-05T23:30:00+09:00")?.id).toBe("transfer_1");
  });

  it("鉄道の代替も、タクシーも間に合わないなら、鉄道の代替を勧める", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:50:00+09:00"),
      taxi("2026-11-05T23:40:00+09:00"),
    ];
    expect(selectBestAlternative(options, "2026-11-05T23:30:00+09:00")?.id).toBe("transfer_1");
  });

  it("近距離の全区間徒歩は、タクシーより先に勧める", () => {
    const options = [walk("2026-11-05T22:20:00+09:00"), taxi("2026-11-05T22:10:00+09:00")];
    expect(selectBestAlternative(options)?.id).toBe("walk");
  });

  it("kind を省いた候補は鉄道の代替として扱う", () => {
    const options = [
      { id: "a", arrivalTime: "2026-11-05T23:30:00+09:00" },
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(selectBestAlternative(options)?.id).toBe("a");
  });
});

describe("selectBestAlternative: タクシーを勧める", () => {
  it("鉄道の代替が無ければ、タクシーを勧める", () => {
    const options = [taxi("2026-11-05T23:10:00+09:00")];
    expect(selectBestAlternative(options)?.id).toBe("taxi");
    expect(selectBestAlternative(options, "2026-11-05T23:00:00+09:00")?.id).toBe("taxi");
  });

  it("鉄道の代替では期限に間に合わず、タクシーなら間に合うときは、タクシーを勧める", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:50:00+09:00"),
      rail("transfer_2", "2026-11-05T23:45:00+09:00"),
      taxi("2026-11-05T23:20:00+09:00"),
    ];
    expect(selectBestAlternative(options, "2026-11-05T23:30:00+09:00")?.id).toBe("taxi");
  });
});

describe("selectBestAlternative: 候補が無い", () => {
  it("空なら null", () => {
    expect(selectBestAlternative([])).toBeNull();
    expect(selectBestAlternative([], "2026-11-05T23:30:00+09:00")).toBeNull();
  });

  it("同着なら先に並んだもの", () => {
    const options = [
      rail("first", "2026-11-05T23:30:00+09:00"),
      rail("second", "2026-11-05T23:30:00+09:00"),
    ];
    expect(selectBestAlternative(options)?.id).toBe("first");
  });
});

describe("chooseBestAlternative: 勧めた理由", () => {
  it("鉄道の代替のうち、いちばん早いものを勧めるときは fastest_rail", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:30:00+09:00"),
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(chooseBestAlternative(options)).toMatchObject({ reason: "fastest_rail" });
    expect(chooseBestAlternative(options, "2026-11-05T23:40:00+09:00")).toMatchObject({
      alternative: { id: "transfer_1" },
      reason: "fastest_rail",
    });
  });

  it("鉄道の代替が無く、タクシーしか無いときは no_rail。期限に間に合わなくても同じ", () => {
    const options = [taxi("2026-11-05T23:10:00+09:00")];
    expect(chooseBestAlternative(options)).toMatchObject({ reason: "no_rail" });
    expect(chooseBestAlternative(options, "2026-11-05T23:00:00+09:00")).toMatchObject({
      alternative: { id: "taxi" },
      reason: "no_rail",
    });
  });

  it("鉄道の代替では期限に間に合わず、タクシーなら間に合うときは rail_misses_deadline", () => {
    const options = [
      rail("transfer_1", "2026-11-05T23:30:00+09:00"),
      taxi("2026-11-05T23:10:00+09:00"),
    ];
    expect(chooseBestAlternative(options, "2026-11-05T23:20:00+09:00")).toMatchObject({
      alternative: { id: "taxi" },
      reason: "rail_misses_deadline",
    });
  });

  it("候補が無ければ null", () => {
    expect(chooseBestAlternative([])).toBeNull();
  });
});

describe("computeBreakEven: 分岐点の求め方", () => {
  const base = {
    now: NOW,
    remaining: { p50: 30, p80: 50 },
    waitRouteMinutesAfterResume: 20,
    firstTrainWaitMinutes: 5,
  };
  const alternatives = [
    rail("transfer_1", "2026-11-05T23:30:00+09:00"),
    taxi("2026-11-05T23:10:00+09:00"),
  ];

  it("鉄道の代替を勧めるときは、タクシーのほうが早くても、鉄道の代替の到着で求める", () => {
    const result = computeBreakEven({ ...base, alternatives });
    // 23:30 − 乗車 20 分 − 初列車待ち 5 分 = 23:05
    expect(result).toMatchObject({
      kind: "future",
      bestAlternativeId: "transfer_1",
      bestAlternativeArrival: "2026-11-05T23:30:00+09:00",
      time: "2026-11-05T23:05:00+09:00",
    });
    expect(result).not.toHaveProperty("deadlineBasis");
  });

  it("期限に問題が無ければ、期限を渡しても鉄道の代替の到着で求める", () => {
    const result = computeBreakEven({
      ...base,
      alternatives,
      deadline: "2026-11-05T23:40:00+09:00",
    });
    expect(result).toMatchObject({
      kind: "future",
      bestAlternativeId: "transfer_1",
      time: "2026-11-05T23:05:00+09:00",
    });
    expect(result).not.toHaveProperty("deadlineBasis");
  });

  it("期限が理由でタクシーを勧める場合は、分岐点が期限から求めた時刻になる", () => {
    const deadline = "2026-11-05T23:20:00+09:00";
    const result = computeBreakEven({ ...base, alternatives, deadline });
    if (result.kind === "no_alternative") throw new Error("代替があるはず");
    // 期限 23:20 − 乗車 20 分 − 初列車待ち 5 分 = 22:55。タクシーの到着 23:10 から求めた 22:45 ではない
    expect(result).toMatchObject({
      kind: "future",
      bestAlternativeId: "taxi",
      bestAlternativeArrival: "2026-11-05T23:10:00+09:00",
      time: "2026-11-05T22:55:00+09:00",
      minutesFromNow: 55,
      deadlineBasis: deadline,
    });
    // 分岐点ちょうどに再開すると、待つ場合は期限ちょうどに着く
    expect(computeWaitArrival(result.time, 5, 20)).toBe(deadline);
    // 再開見込みは、タクシーの到着ではなく期限から求めた分岐点と比べる
    expect(result.resumeOutlook).toMatchObject({
      resumeP50: "2026-11-05T22:25:00+09:00",
      marginP50Minutes: 30,
      marginP80Minutes: 10,
    });
  });

  it("期限が理由でタクシーを勧め、期限から求めた分岐点を過ぎていれば passed", () => {
    // 期限 22:20 − 25 分 = 21:55 はもう過ぎている。いま再開しても待って期限に間に合わない
    const result = computeBreakEven({
      ...base,
      alternatives: [
        rail("transfer_1", "2026-11-05T23:30:00+09:00"),
        taxi("2026-11-05T22:15:00+09:00"),
      ],
      deadline: "2026-11-05T22:20:00+09:00",
    });
    expect(result).toMatchObject({
      kind: "passed",
      bestAlternativeId: "taxi",
      time: "2026-11-05T21:55:00+09:00",
      deadlineBasis: "2026-11-05T22:20:00+09:00",
    });
  });

  it("タクシーしか無い場合は、期限があっても、タクシーの到着と並ぶ時刻のままにする", () => {
    const onlyTaxi = [taxi("2026-11-05T23:10:00+09:00")];
    // 23:10 − 20 分 − 5 分 = 22:45
    for (const deadline of [null, "2026-11-05T23:20:00+09:00", "2026-11-05T23:00:00+09:00"]) {
      const result = computeBreakEven({ ...base, alternatives: onlyTaxi, deadline });
      expect(result).toMatchObject({
        kind: "future",
        bestAlternativeId: "taxi",
        bestAlternativeArrival: "2026-11-05T23:10:00+09:00",
        time: "2026-11-05T22:45:00+09:00",
      });
      expect(result).not.toHaveProperty("deadlineBasis");
    }
  });

  it("鉄道の代替もタクシーも期限に間に合わないときは、鉄道の代替の到着で求める", () => {
    const result = computeBreakEven({
      ...base,
      alternatives,
      deadline: "2026-11-05T23:00:00+09:00",
    });
    expect(result).toMatchObject({
      kind: "future",
      bestAlternativeId: "transfer_1",
      time: "2026-11-05T23:05:00+09:00",
    });
    expect(result).not.toHaveProperty("deadlineBasis");
  });
});

describe("乗る駅までの徒歩の上限", () => {
  it("広げた上限は、通常の上限より長い", () => {
    expect(ACCESS_WALK_MAX_MINUTES_EXTENDED).toBeGreaterThan(ACCESS_WALK_MAX_MINUTES);
  });
});
