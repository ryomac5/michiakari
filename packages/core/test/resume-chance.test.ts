import { join } from "node:path";
import type { Knowledge, ResumeChance } from "@repo/schema";
import { findRepoRoot, loadKnowledgeDir } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import {
  CHANCE_TICK_COUNT,
  CHANCE_TICK_STEPS_MINUTES,
  computeBreakEven,
  computeChanceWithin,
  computeMovingProbability,
  computeQuantile,
  computeResumeChance,
  computeWaitFasterProbability,
  diffMinutes,
  estimateBranchAwareRemaining,
  estimateStatedRemainingWithoutKnowledge,
  getJstMinuteOfDay,
  listChanceTickTimes,
  mergeBranchSamples,
  parseIsoToMs,
  type ResumeChanceInput,
  roundChanceTenths,
  sampleDurationDist,
  sampleRemaining,
  selectKeyTick,
} from "../src/index.ts";
import {
  constantKnowledge,
  lognormalKnowledge,
  singlePhaseKnowledge,
} from "./fixtures/knowledge.ts";

// 時刻ごとの再開の見込みと、待ったほうが早く着く確率。残り時間の推定と同じ標本から数える

const DEV_KNOWLEDGE_DIR = join(
  findRepoRoot(),
  "packages/schema/test/fixtures/dev-content/knowledge",
);

function loadDevKnowledge(id: string): Knowledge {
  const entry = loadKnowledgeDir(DEV_KNOWLEDGE_DIR).entries.find((e) => e.data.id === id);
  if (!entry) throw new Error(`ダミーの知見がありません: ${id}`);
  return entry.data;
}

const personAccident = loadDevKnowledge("person_accident");
const inCar = loadDevKnowledge("in_car_response");

const at = (clock: string, day = "05") => `2026-11-${day}T${clock}:00+09:00`;
const now = at("22:10");

function buildInput(overrides: Partial<ResumeChanceInput> = {}): ResumeChanceInput {
  return {
    now,
    samples: sampleRemaining(lognormalKnowledge, "initial", 0),
    firstTrainWaitMinutes: 5,
    waitRouteMinutesAfterResume: 20,
    bestAlternativeArrival: at("23:10"),
    breakEvenTime: at("22:45"),
    deadline: null,
    onsetTime: now,
    ...overrides,
  };
}

function expectMonotone(chance: ResumeChance): void {
  for (let i = 1; i < chance.ticks.length; i++) {
    expect(chance.ticks[i]?.tenths).toBeGreaterThanOrEqual(chance.ticks[i - 1]?.tenths ?? 0);
  }
}

function minuteOfDay(iso: string): number {
  return getJstMinuteOfDay(iso);
}

describe("roundChanceTenths", () => {
  it("1 割単位に丸め、境目は 0.05 未満が 1 割未満、0.95 以上が 9 割以上", () => {
    expect(roundChanceTenths(0)).toBe(0);
    expect(roundChanceTenths(0.049)).toBe(0);
    expect(roundChanceTenths(0.05)).toBe(1);
    expect(roundChanceTenths(0.149)).toBe(1);
    expect(roundChanceTenths(0.15)).toBe(2);
    expect(roundChanceTenths(0.5)).toBe(5);
    expect(roundChanceTenths(0.949)).toBe(9);
    expect(roundChanceTenths(0.95)).toBe(10);
    expect(roundChanceTenths(1)).toBe(10);
  });

  it("0 割と 10 割は出さない", () => {
    const values = Array.from({ length: 1001 }, (_, i) => roundChanceTenths(i / 1000));
    expect(values.every((v) => v >= 0 && v <= 10 && Number.isInteger(v))).toBe(true);
  });

  it("範囲外は例外", () => {
    expect(() => roundChanceTenths(-0.1)).toThrow(RangeError);
    expect(() => roundChanceTenths(1.1)).toThrow(RangeError);
  });
});

describe("computeChanceWithin", () => {
  it("昇順の標本のうち minutes 以下の割合を返す。同じ値は含める", () => {
    const sorted = [1, 2, 2, 3, 10];
    expect(computeChanceWithin(sorted, 0)).toBe(0);
    expect(computeChanceWithin(sorted, 2)).toBe(0.6);
    expect(computeChanceWithin(sorted, 9.99)).toBe(0.8);
    expect(computeChanceWithin(sorted, 10)).toBe(1);
  });
});

describe("listChanceTickTimes", () => {
  it("いまより後の切りのよい時刻から始め、終わりを覆う最小の刻みを選ぶ", () => {
    const ticks = listChanceTickTimes(parseIsoToMs(at("22:10")), parseIsoToMs(at("00:20", "06")));
    expect(ticks.stepMinutes).toBe(30);
    expect(ticks.times.map((ms) => minuteOfDay(new Date(ms).toISOString()))).toEqual(
      ["22:30", "23:00", "23:30", "00:00", "00:30"].map((c) => minuteOfDay(at(c))),
    );
  });

  it("短い見込みでも目盛りは 4 個まで延ばす", () => {
    const ticks = listChanceTickTimes(parseIsoToMs(at("18:20")), parseIsoToMs(at("18:36")));
    expect(ticks.stepMinutes).toBe(10);
    expect(ticks.times.map((ms) => minuteOfDay(new Date(ms).toISOString()))).toEqual(
      ["18:30", "18:40", "18:50", "19:00"].map((c) => minuteOfDay(at(c))),
    );
  });

  it("いまが切りのよい時刻なら、その次の時刻から始める", () => {
    const ticks = listChanceTickTimes(parseIsoToMs(at("22:00")), parseIsoToMs(at("22:50")));
    expect(ticks.stepMinutes).toBe(10);
    expect(minuteOfDay(new Date(ticks.times[0] ?? 0).toISOString())).toBe(minuteOfDay(at("22:10")));
    // 10 分刻みでは 6 個を超えるので 15 分刻みになる
    const wider = listChanceTickTimes(parseIsoToMs(at("22:00")), parseIsoToMs(at("23:05")));
    expect(wider.stepMinutes).toBe(15);
    expect(minuteOfDay(new Date(wider.times[0] ?? 0).toISOString())).toBe(minuteOfDay(at("22:15")));
  });

  it("6 時間を超えても 60 分刻みの 6 個で打ち切る", () => {
    const ticks = listChanceTickTimes(parseIsoToMs(at("10:05")), parseIsoToMs(at("20:00")));
    expect(ticks.stepMinutes).toBe(60);
    expect(ticks.times).toHaveLength(CHANCE_TICK_COUNT.max);
  });

  it("刻みは候補の中から選び、目盛りはその刻みの倍数の時刻になる", () => {
    for (const end of ["22:25", "22:40", "23:10", "23:59", "01:30"]) {
      const day = end < "22:10" ? "06" : "05";
      const ticks = listChanceTickTimes(parseIsoToMs(at("22:10")), parseIsoToMs(at(end, day)));
      expect(CHANCE_TICK_STEPS_MINUTES).toContain(ticks.stepMinutes);
      expect(ticks.times.length).toBeGreaterThanOrEqual(CHANCE_TICK_COUNT.min);
      expect(ticks.times.length).toBeLessThanOrEqual(CHANCE_TICK_COUNT.max);
      for (const ms of ticks.times) {
        expect(minuteOfDay(new Date(ms).toISOString()) % ticks.stepMinutes).toBe(0);
        expect(ms).toBeGreaterThan(parseIsoToMs(at("22:10")));
      }
    }
  });
});

describe("computeResumeChance", () => {
  it("確率は時刻とともに減らず、目盛りは切りのよい時刻になる", () => {
    const chance = computeResumeChance(buildInput());
    expectMonotone(chance);
    for (const tick of chance.ticks) {
      expect(minuteOfDay(tick.time) % chance.stepMinutes).toBe(0);
    }
    expect(chance.ticks.length).toBeGreaterThanOrEqual(CHANCE_TICK_COUNT.min);
    expect(chance.ticks.length).toBeLessThanOrEqual(CHANCE_TICK_COUNT.max);
  });

  it("最後の目盛りはほぼ動いている時刻を覆うので 9 割か 9 割以上になる", () => {
    for (const samples of [
      sampleRemaining(lognormalKnowledge, "initial", 0),
      sampleRemaining(lognormalKnowledge, "recovering", 10),
      sampleDurationDist({ p50: 2, p80: 5 }),
    ]) {
      const chance = computeResumeChance(buildInput({ samples, breakEvenTime: null }));
      expect(chance.ticks.at(-1)?.tenths).toBeGreaterThanOrEqual(9);
    }
  });

  it("発生時刻を渡すと、各目盛りに発生からの分が付く。無ければ null", () => {
    const withOnset = computeResumeChance(buildInput({ onsetTime: at("21:50") }));
    for (const tick of withOnset.ticks) {
      expect(tick.sinceOnsetMinutes).toBe(Math.round(diffMinutes(at("21:50"), tick.time)));
    }
    const withoutOnset = computeResumeChance(buildInput({ onsetTime: null }));
    expect(withoutOnset.onsetTime).toBeNull();
    expect(withoutOnset.ticks.every((t) => t.sinceOnsetMinutes === null)).toBe(true);
  });

  it("人身事故では、発生から下限の時刻までの目盛りが 1 割未満になる", () => {
    const onset = at("22:10");
    const estimate = estimateBranchAwareRemaining(personAccident, "initial", 0, {
      elapsedSinceOnsetMinutes: 0,
    });
    const chance = computeResumeChance(
      buildInput({
        now: onset,
        samples: estimate.samples,
        firstTrainWaitMinutes: personAccident.after_resume.first_train_wait_minutes.p50,
        waitRouteMinutesAfterResume: 30,
        bestAlternativeArrival: at("23:26"),
        breakEvenTime: at("22:46"),
        deadline: at("00:25", "06"),
        onsetTime: onset,
      }),
    );
    const floor = personAccident.predictability?.typical_floor_minutes ?? 0;
    const before = chance.ticks.filter((t) => (t.sinceOnsetMinutes ?? 0) < floor);
    const after = chance.ticks.filter((t) => (t.sinceOnsetMinutes ?? 0) >= floor + 15);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(before.every((t) => t.tenths === 0)).toBe(true);
    expect(after.every((t) => t.tenths >= 5)).toBe(true);
    // 分岐点 22:46 は下限の前なので、待ったほうが早く着く見込みも 1 割未満
    expect(chance.waitFaster).toBe(0);
    expect(chance.waitOnTime).not.toBeNull();
    expect(chance.resumeByForDeadline).toBe(at("23:45"));
  });

  it("車内対応では、発生から 10 分ほどの目盛りが高い確率になる", () => {
    const onset = at("18:20", "09");
    const estimate = estimateBranchAwareRemaining(inCar, "stopped_for_check", 0, {
      elapsedSinceOnsetMinutes: 0,
    });
    const chance = computeResumeChance(
      buildInput({
        now: onset,
        samples: estimate.samples,
        firstTrainWaitMinutes: inCar.after_resume.first_train_wait_minutes.p50,
        waitRouteMinutesAfterResume: 15,
        bestAlternativeArrival: at("19:00", "09"),
        breakEvenTime: at("18:43", "09"),
        onsetTime: onset,
      }),
    );
    const tenMinutes = chance.ticks.find((t) => t.sinceOnsetMinutes === 10);
    expect(tenMinutes?.tenths).toBeGreaterThanOrEqual(7);
    expect(chance.waitFaster).toBeGreaterThanOrEqual(9);
  });

  it("経過時間で条件を付けると、見込みが前に寄る", () => {
    // 1 段階の知見。段階に 8 分いた条件を付けると、残りの中央値は条件なしより短い
    const freshSamples = sampleRemaining(singlePhaseKnowledge, "only", 0);
    const elapsedSamples = sampleRemaining(singlePhaseKnowledge, "only", 8);
    expect(computeQuantile(elapsedSamples, 0.5)).toBeLessThan(computeQuantile(freshSamples, 0.5));
    const fresh = computeResumeChance(
      buildInput({ samples: freshSamples, firstTrainWaitMinutes: 0, breakEvenTime: null }),
    );
    const elapsed = computeResumeChance(
      buildInput({ samples: elapsedSamples, firstTrainWaitMinutes: 0, breakEvenTime: null }),
    );
    // 5 割に達する目盛りは、経過の長いほうが同じか早い
    const freshKey = selectKeyTick(fresh.ticks);
    const elapsedKey = selectKeyTick(elapsed.ticks);
    if (!freshKey || !elapsedKey) throw new Error("目盛りがありません");
    expect(parseIsoToMs(elapsedKey.time)).toBeLessThanOrEqual(parseIsoToMs(freshKey.time));
    // 同じ時刻で比べても、経過の長いほうの確率は同じか高い
    const probabilityAt = (samples: readonly number[], time: string) =>
      roundChanceTenths(computeMovingProbability({ now, samples, firstTrainWaitMinutes: 0, time }));
    for (const tick of fresh.ticks.filter((t) => t.tenths > 0 && t.tenths < 10)) {
      expect(probabilityAt(elapsedSamples, tick.time)).toBeGreaterThanOrEqual(tick.tenths);
    }
    expect(elapsed.waitFaster ?? 0).toBeGreaterThanOrEqual(fresh.waitFaster ?? 0);
  });

  it("定数の分布では、その時刻の前は 1 割未満、以後は 9 割以上になる", () => {
    // 全段階の和 35 分、初列車待ち 5 分。再開の時刻は 22:10 + 35 − 5 = 22:40
    const samples = sampleRemaining(constantKnowledge, "first", 0);
    const chance = computeResumeChance(
      buildInput({
        samples,
        firstTrainWaitMinutes: 5,
        waitRouteMinutesAfterResume: 10,
        bestAlternativeArrival: at("22:55"),
        breakEvenTime: at("22:40"),
      }),
    );
    for (const tick of chance.ticks) {
      expect(tick.tenths).toBe(parseIsoToMs(tick.time) < parseIsoToMs(at("22:40")) ? 0 : 10);
    }
    // 同着は待つ側に数える。待った場合の到着 22:55 は代替手段の 22:55 と同じ
    expect(chance.waitFaster).toBe(10);
    const oneMinuteEarlier = computeResumeChance(
      buildInput({
        samples,
        firstTrainWaitMinutes: 5,
        waitRouteMinutesAfterResume: 10,
        bestAlternativeArrival: at("22:54"),
        breakEvenTime: at("22:39"),
      }),
    );
    expect(oneMinuteEarlier.waitFaster).toBe(0);
  });

  it("発表の時刻だけの場合は、発表の時刻でおよそ 5 割、延びる余地の先で 8 割になる", () => {
    const stated = at("22:40");
    const remaining = estimateStatedRemainingWithoutKnowledge(stated, now);
    const samples = sampleDurationDist(remaining);
    const chance = computeResumeChance(
      buildInput({
        samples,
        firstTrainWaitMinutes: 0,
        waitRouteMinutesAfterResume: 20,
        bestAlternativeArrival: at("23:10"),
        breakEvenTime: at("22:50"),
      }),
    );
    expectMonotone(chance);
    const atStated = roundChanceTenths(computeChanceWithin(samples, remaining.p50));
    const atP80 = roundChanceTenths(computeChanceWithin(samples, remaining.p80));
    expect(atStated).toBe(5);
    expect(atP80).toBe(8);
    expect(chance.ticks.map((t) => minuteOfDay(t.time) % 10).every((m) => m === 0)).toBe(true);
  });

  it("代替手段が無ければ、待ったほうが早く着く確率を出さない", () => {
    const chance = computeResumeChance(
      buildInput({ bestAlternativeArrival: null, breakEvenTime: null }),
    );
    expect(chance.waitFaster).toBeNull();
    const noRoute = computeResumeChance(
      buildInput({ waitRouteMinutesAfterResume: null, deadline: at("23:30") }),
    );
    expect(noRoute.waitFaster).toBeNull();
    expect(noRoute.waitOnTime).toBeNull();
    expect(noRoute.resumeByForDeadline).toBeNull();
    expect(noRoute.ticks.length).toBeGreaterThanOrEqual(CHANCE_TICK_COUNT.min);
  });

  it("期限があれば、待って期限に間に合う確率と、そのために動いていなければならない時刻を返す", () => {
    const chance = computeResumeChance(buildInput({ deadline: at("23:30") }));
    expect(chance.waitOnTime).not.toBeNull();
    // 期限 23:30 − 乗車 20 分 − 初列車待ち 5 分
    expect(chance.resumeByForDeadline).toBe(at("23:05"));
  });

  it("標本が空か昇順でなければ例外", () => {
    expect(() => computeResumeChance(buildInput({ samples: [] }))).toThrow(RangeError);
    expect(() => computeResumeChance(buildInput({ samples: [3, 1, 2] }))).toThrow(RangeError);
  });
});

describe("待ったほうが早く着く確率と分岐点の整合", () => {
  // 標本ごとに T_wait = now + s + 乗車時間 を作り、T_alt 以下の割合を直接数える
  function countDirect(
    samples: readonly number[],
    waitRouteMinutes: number,
    bestAlternativeArrival: string,
  ): number {
    const nowMs = parseIsoToMs(now);
    const altMs = parseIsoToMs(bestAlternativeArrival);
    const hits = samples.filter((s) => nowMs + (s + waitRouteMinutes) * 60_000 <= altMs).length;
    return hits / samples.length;
  }

  it("分岐点の定義から求めた確率と、標本で直接数えた P(T_wait ≤ T_alt) が一致する", () => {
    const cases = [
      { samples: sampleRemaining(lognormalKnowledge, "initial", 0), ftw: 5, route: 20 },
      { samples: sampleRemaining(lognormalKnowledge, "working", 12), ftw: 5, route: 7 },
      { samples: sampleRemaining(constantKnowledge, "first", 0), ftw: 5, route: 10 },
      {
        samples: estimateBranchAwareRemaining(personAccident, "initial", 0, {
          elapsedSinceOnsetMinutes: 0,
        }).samples,
        ftw: 10,
        route: 30,
      },
    ];
    for (const { samples, ftw, route } of cases) {
      for (const arrival of ["22:40", "22:55", "23:10", "23:26", "23:45", "00:15"]) {
        const day = arrival < "22:10" ? "06" : "05";
        const bestAlternativeArrival = at(arrival, day);
        const breakEven = computeBreakEven({
          now,
          remaining: { p50: 1, p80: 2 },
          waitRouteMinutesAfterResume: route,
          firstTrainWaitMinutes: ftw,
          alternatives: [{ id: "alt", arrivalTime: bestAlternativeArrival }],
        });
        if (breakEven.kind === "no_alternative") throw new Error("分岐点がありません");
        // 分岐点の定義: T_alt − 乗車時間 − 初列車待ち。P(s ≤ 分岐点までの分 + 初列車待ち)
        const viaBreakEven = computeChanceWithin(samples, diffMinutes(now, breakEven.time) + ftw);
        const direct = countDirect(samples, route, bestAlternativeArrival);
        const computed = computeWaitFasterProbability({
          now,
          samples,
          waitRouteMinutesAfterResume: route,
          bestAlternativeArrival,
        });
        expect(computed).toBe(direct);
        expect(viaBreakEven).toBe(direct);
      }
    }
  });

  it("分岐点までの確率は、再開見込みの p50 でおよそ 5 割、p80 でおよそ 8 割になる", () => {
    const samples = sampleRemaining(lognormalKnowledge, "initial", 0);
    const ftw = 5;
    const p50 = computeQuantile(samples, 0.5);
    const p80 = computeQuantile(samples, 0.8);
    const tenthsAt = (minutes: number) =>
      roundChanceTenths(computeChanceWithin(samples, minutes - ftw + ftw));
    expect(tenthsAt(p50)).toBe(5);
    expect(tenthsAt(p80)).toBe(8);
  });
});

describe("mergeBranchSamples", () => {
  const shortest = sampleRemaining(lognormalKnowledge, "initial", 0);
  const longest = sampleRemaining(lognormalKnowledge, "initial", 0).map((v) => v * 1.5);

  it("p50 は最短の経路、p80 は最長の経路の値になり、昇順を保つ", () => {
    const merged = mergeBranchSamples(shortest, longest);
    expect(merged).toHaveLength(shortest.length);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]).toBeGreaterThanOrEqual(merged[i - 1] ?? 0);
    }
    expect(computeQuantile(merged, 0.5)).toBeCloseTo(computeQuantile(shortest, 0.5), 1);
    expect(computeQuantile(merged, 0.8)).toBeCloseTo(computeQuantile(longest, 0.8), 1);
    // p50 より下は最短の経路の標本そのもの
    expect(computeQuantile(merged, 0.2)).toBeCloseTo(computeQuantile(shortest, 0.2), 1);
  });

  it("人身事故の標本の p50・p80 は、残り時間の推定と一致する", () => {
    const estimate = estimateBranchAwareRemaining(personAccident, "initial", 0, {
      elapsedSinceOnsetMinutes: 0,
    });
    expect(Math.round(computeQuantile(estimate.samples, 0.5))).toBe(estimate.remaining.p50);
    expect(Math.round(computeQuantile(estimate.samples, 0.8))).toBe(estimate.remaining.p80);
    // 分岐しない知見の標本は、そのままの標本
    const plain = estimateBranchAwareRemaining(inCar, "stopped_for_check", 0);
    expect(plain.samples).toEqual(sampleRemaining(inCar, "stopped_for_check", 0));
  });
});

describe("selectKeyTick", () => {
  it("5 割に達する最初の目盛りを選び、無ければ最後の目盛り", () => {
    const ticks = [
      { time: at("22:30"), tenths: 0, sinceOnsetMinutes: null },
      { time: at("23:00"), tenths: 4, sinceOnsetMinutes: null },
      { time: at("23:30"), tenths: 5, sinceOnsetMinutes: null },
      { time: at("00:00", "06"), tenths: 8, sinceOnsetMinutes: null },
    ];
    expect(selectKeyTick(ticks)?.time).toBe(at("23:30"));
    expect(selectKeyTick(ticks.slice(0, 2))?.time).toBe(at("23:00"));
    expect(selectKeyTick([])).toBeNull();
    expect(selectKeyTick(ticks, at("23:00"))?.time).toBe(at("00:00", "06"));
    expect(selectKeyTick(ticks, at("00:00", "06"))).toBeNull();
    expect(selectKeyTick(ticks.slice(0, 3), at("23:00"))).toBeNull();
    expect(selectKeyTick([], at("23:00"))).toBeNull();
  });
});
