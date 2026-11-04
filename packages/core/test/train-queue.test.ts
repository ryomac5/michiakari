import { describe, expect, it } from "vitest";
import { DEFAULT_TRAIN_QUEUE_PARAMS } from "../params/train-queue.ts";
import { computeBreakEven } from "../src/break-even.ts";
import { addMinutesToIso } from "../src/time.ts";
import {
  countTrainsAhead,
  estimateTrainQueueArrival,
  findOperationPattern,
  inferDefaultOwnTrainType,
  inferTrainsAheadFromPattern,
  normalizeTrainType,
  resolveStationPlatform,
  resolveTrainQueueParams,
  type StationAhead,
  type TrainQueueInput,
} from "../src/train-queue.ts";

// 駅間に止まった列車が、ホームに着ける駅に着く見込み。JR神戸線の大阪から神戸へ向かう架空の夜
// 塚本は普通しか着けず、尼崎はどの種別も 2 本まで入れる

const NOW = "2026-11-05T22:00:00+09:00";
const LINE = "jr-west.東海道線";
const jrWest = resolveTrainQueueParams("JR西日本");

function station(name: string, ride: number): StationAhead {
  return { name, rideMinutesFromPrevious: ride, platform: resolveStationPlatform(LINE, name) };
}

// 大阪を出て塚本の手前で止まった想定。次は塚本、その先は尼崎、立花、甲子園口
const fromOsaka = [
  station("塚本", 3),
  station("尼崎", 4),
  station("立花", 3),
  station("甲子園口", 3),
];
// 塚本を出て尼崎の手前で止まった想定
const fromTsukamoto = [station("尼崎", 4), station("立花", 3), station("甲子園口", 3)];

function build(overrides: Partial<TrainQueueInput>): TrainQueueInput {
  return {
    now: NOW,
    untilResume: { p50: 30, p80: 60 },
    ownTrainType: "local",
    trainsAhead: [],
    trainsAheadCount: null,
    stationsAhead: fromOsaka,
    params: jrWest,
    ...overrides,
  };
}

describe("resolveTrainQueueParams と表", () => {
  it("JR西日本は詰め、ほかの事業者と不明は既定の詰めない値を使う", () => {
    expect(jrWest.closesUp).toBe(true);
    expect(resolveTrainQueueParams("阪急")).toEqual(DEFAULT_TRAIN_QUEUE_PARAMS);
    expect(resolveTrainQueueParams(null).closesUp).toBe(false);
  });

  it("表に無い駅はどの種別も着け、種別が分からない列車は普通として扱う", () => {
    expect(resolveStationPlatform(LINE, "架空の駅").accepts).toContain("special_rapid");
    expect(resolveStationPlatform("hankyu.神戸線", "塚本").accepts).toContain("rapid");
    expect(resolveStationPlatform(LINE, "塚本").accepts).toEqual(["local"]);
    expect(normalizeTrainType("unknown")).toBe("local");
    expect(normalizeTrainType(null)).toBe("local");
    expect(normalizeTrainType("rapid")).toBe("rapid");
  });

  it("本数は並びの長さを優先し、並びが無ければ目安から置く", () => {
    expect(countTrainsAhead(["rapid", "local"], "many")).toBe(2);
    expect(countTrainsAhead([], null)).toBe(0);
    expect(countTrainsAhead(null, "few")).toBe(2);
    expect(countTrainsAhead(null, "many")).toBe(3);
    expect(countTrainsAhead(null, "unknown")).toBe(1);
    expect(countTrainsAhead(null, null)).toBe(0);
  });
});

describe("運転パターンからの既定値", () => {
  const kobeBound = ["塚本", "尼崎", "芦屋", "三ノ宮", "神戸"];
  const pattern = findOperationPattern(LINE, kobeBound);

  it("路線と先の駅の並びからパターンを引き、いちばん多い種別を自分の既定にする", () => {
    expect(pattern?.cycleMinutes).toBe(15);
    expect(inferDefaultOwnTrainType(pattern)).toBe("local");
    expect(inferDefaultOwnTrainType(null)).toBe("local");
    expect(findOperationPattern("hankyu.神戸線", kobeBound)).toBeNull();
    expect(findOperationPattern(LINE, ["架空の駅"])).toBeNull();
  });

  it("自分が普通なら、複々線の同じ線路を走る普通だけを 3 本並べる", () => {
    expect(inferTrainsAheadFromPattern(pattern, "local")).toEqual(["local", "local", "local"]);
    expect(inferTrainsAheadFromPattern(pattern, "unknown")).toEqual(["local", "local", "local"]);
  });

  it("自分が快速なら、快速系の線路の列車を近い順に並べる", () => {
    expect(inferTrainsAheadFromPattern(pattern, "rapid")).toEqual([
      "special_rapid",
      "rapid",
      "special_rapid",
    ]);
    expect(inferTrainsAheadFromPattern(pattern, "special_rapid", 2)).toEqual([
      "rapid",
      "special_rapid",
    ]);
  });

  it("パターンが無い路線と、パターンに無い種別は null にする", () => {
    expect(inferTrainsAheadFromPattern(null, "local")).toBeNull();
    expect(inferTrainsAheadFromPattern(pattern, "limited_express")).toBeNull();
  });
});

describe("estimateTrainQueueArrival", () => {
  it("前に列車がいなければ、詰める動きで再開の前に次の駅に着く", () => {
    const outcome = estimateTrainQueueArrival(build({ trainsAhead: [] }));
    expect(outcome.alightStation).toBe("塚本");
    expect(outcome.beforeResume).toBe(true);
    expect(outcome.trainsAheadCount).toBe(0);
    expect(outcome.delays).toEqual([]);
    // 詰め始めるまで 10 分 + 塚本まで 3 分
    expect(outcome.arrival).toEqual({
      p50: addMinutesToIso(NOW, 13),
      p80: addMinutesToIso(NOW, 23),
    });
  });

  it("前が普通だけなら、その普通が次の駅に入り、自分は 2 本入れる駅へ詰められる", () => {
    const outcome = estimateTrainQueueArrival(
      build({ trainsAhead: ["local"], stationsAhead: fromTsukamoto }),
    );
    expect(outcome.alightStation).toBe("尼崎");
    expect(outcome.beforeResume).toBe(true);
    expect(outcome.delays).toEqual([]);
    // 10 分 + 前の 1 本ぶん 3 分 + 尼崎まで 4 分
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 17));
  });

  it("前が普通だけでも、次の駅のホームが 1 本ぶんしか無ければ、自分は再開のあとに着く", () => {
    const outcome = estimateTrainQueueArrival(build({ trainsAhead: ["local"] }));
    expect(outcome.alightStation).toBe("塚本");
    expect(outcome.beforeResume).toBe(false);
    expect(outcome.delays).toEqual([{ kind: "station_full", station: "塚本" }]);
    // 再開まで 30 分 + 前の 1 本ぶん 3 分 + 塚本まで 3 分
    expect(outcome.arrival).toEqual({
      p50: addMinutesToIso(NOW, 36),
      p80: addMinutesToIso(NOW, 66),
    });
  });

  it("すぐ前が次の駅に入れない快速なら、その快速が駅間に残り、自分も再開のあとに着く", () => {
    const outcome = estimateTrainQueueArrival(build({ trainsAhead: ["rapid", "local"] }));
    expect(outcome.alightStation).toBe("塚本");
    expect(outcome.beforeResume).toBe(false);
    expect(outcome.delays).toEqual([
      { kind: "ahead_cannot_enter", trainType: "rapid", station: "塚本" },
    ]);
    // 再開まで 30 分 + 前の 2 本ぶん 6 分 + 塚本まで 3 分
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 39));
  });

  it("すぐ前の快速の前が空いていれば、快速は先の駅へ進み、自分は次の駅に着ける", () => {
    const outcome = estimateTrainQueueArrival(build({ trainsAhead: ["rapid"] }));
    expect(outcome.alightStation).toBe("塚本");
    expect(outcome.beforeResume).toBe(true);
    expect(outcome.delays).toEqual([]);
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 16));
  });

  it("自分が快速で次の駅に着けなければ、降りられるのはその先の駅になる", () => {
    const outcome = estimateTrainQueueArrival(build({ ownTrainType: "rapid" }));
    expect(outcome.alightStation).toBe("尼崎");
    expect(outcome.beforeResume).toBe(true);
    expect(outcome.delays).toEqual([{ kind: "own_cannot_stop", station: "塚本" }]);
    // 10 分 + 塚本まで 3 分 + 尼崎まで 4 分
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 17));
  });

  it("詰めない事業者では、前に列車がいなくても再開を待ってから着く", () => {
    const outcome = estimateTrainQueueArrival(build({ params: resolveTrainQueueParams("阪急") }));
    expect(outcome.beforeResume).toBe(false);
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 33));
  });

  it("並びが分からなければ本数の目安を普通として置く。3 本以上なら 3 本ぶん遅れる", () => {
    const outcome = estimateTrainQueueArrival(
      build({ trainsAhead: null, trainsAheadCount: "many" }),
    );
    expect(outcome.trainsAheadCount).toBe(3);
    expect(outcome.beforeResume).toBe(false);
    // 再開まで 30 分 + 3 本ぶん 9 分 + 塚本まで 3 分
    expect(outcome.arrival?.p50).toBe(addMinutesToIso(NOW, 42));
  });

  it("再開の見込みが無くても、詰める事業者なら詰める動きの時刻を返す。詰めなければ null", () => {
    expect(estimateTrainQueueArrival(build({ untilResume: null })).arrival?.p50).toBe(
      addMinutesToIso(NOW, 13),
    );
    expect(
      estimateTrainQueueArrival(
        build({ untilResume: null, params: resolveTrainQueueParams("阪急") }),
      ).arrival,
    ).toBeNull();
  });

  it("前の駅が無ければ例外", () => {
    expect(() => estimateTrainQueueArrival(build({ stationsAhead: [] }))).toThrow(RangeError);
  });
});

// 次の駅に着いてから乗り換える代替手段と、乗ったまま再開を待つ場合を分岐点で比べる
describe("次の駅に着く見込みと分岐点", () => {
  const waitRouteMinutesAfterResume = 20;
  // 次の駅に着いてから 30 分で着く代替手段
  const alternativeFrom = (arrival: string) => [
    { id: "transfer", arrivalTime: addMinutesToIso(arrival, 30) },
  ];

  it("再開の見込みが分岐点より前なら、乗ったまま待つほうが早い", () => {
    const untilResume = { p50: 5, p80: 10 };
    const outcome = estimateTrainQueueArrival(build({ untilResume }));
    expect(outcome.beforeResume).toBe(false);
    const result = computeBreakEven({
      now: NOW,
      remaining: untilResume,
      waitRouteMinutesAfterResume,
      firstTrainWaitMinutes: 0,
      alternatives: alternativeFrom(outcome.arrival?.p50 ?? NOW),
    });
    expect(result.kind).toBe("future");
    if (result.kind !== "future") return;
    expect(result.resumeOutlook?.marginP50Minutes).toBeGreaterThan(0);
  });

  it("再開の見込みが分岐点より後なら、次の駅で降りて乗り換えるほうが早い", () => {
    const untilResume = { p50: 60, p80: 90 };
    const outcome = estimateTrainQueueArrival(build({ untilResume }));
    expect(outcome.beforeResume).toBe(true);
    const result = computeBreakEven({
      now: NOW,
      remaining: untilResume,
      waitRouteMinutesAfterResume,
      firstTrainWaitMinutes: 0,
      alternatives: alternativeFrom(outcome.arrival?.p50 ?? NOW),
    });
    expect(result.kind).toBe("future");
    if (result.kind !== "future") return;
    expect(result.resumeOutlook?.marginP50Minutes).toBeLessThan(0);
  });
});
