import { computeArrival, MAX_ROUTE_CANDIDATES } from "@repo/core";
import { type RouteOption, RouteOptionSchema, LINE_TYPES as SCHEMA_LINE_TYPES } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  applyNetworkCorrections,
  type BlockedSection,
  type FindAlternativeRoutesInput,
  LINE_TYPES,
} from "../src/index.ts";
import { loadNetworkData, loadRouter } from "../src/node.ts";

// 経路探索は網の補正（阪急京都線の大阪梅田発など）を足した網で行うので、照合も同じ網で行う
const network = applyNetworkCorrections(loadNetworkData());
const router = loadRouter();

const DAYTIME = "2026-11-05T14:00:00+09:00";
const LATE_NIGHT = "2026-11-05T23:30:00+09:00";

function resolveStation(name: string, lineHint: string): string {
  const id = router.resolveStationId(name, lineHint);
  if (id === null) throw new Error(`${lineHint} の ${name} が見つかりません`);
  return id;
}

function buildSection(lineId: string, from: string, to: string): BlockedSection {
  return {
    lineId,
    fromStationId: resolveStation(from, lineId),
    toStationId: resolveStation(to, lineId),
  };
}

// 路線の区間ごとの駅の並びから、乗車区間が止まっている区間を含むかを調べる
function checkCoversSection(leg: RouteOption["legs"][number], section: BlockedSection): boolean {
  if (leg.mode !== "ride" || leg.lineId !== section.lineId) return false;
  const line = network.lines.find((l) => l.lineId === section.lineId);
  for (const segment of line?.segments ?? []) {
    const index = (id: string | undefined) =>
      id === undefined ? -1 : segment.stationIds.indexOf(id);
    const [a, b, s, t] = [
      index(leg.fromStationId),
      index(leg.toStationId),
      index(section.fromStationId),
      index(section.toStationId),
    ];
    if (a < 0 || b < 0 || s < 0 || t < 0) continue;
    const [legLo, legHi] = [Math.min(a, b), Math.max(a, b)];
    const [secLo, secHi] = [Math.min(s, t), Math.max(s, t)];
    if (legLo < secHi && legHi > secLo) return true;
  }
  return false;
}

function listRideLineIds(option: RouteOption): string[] {
  return option.legs.filter((l) => l.mode === "ride").map((l) => l.lineId ?? "");
}

function expectConsistentOptions(options: RouteOption[], departureTime: string): void {
  const stationIds = new Set(network.nodes.map((n) => n.stationId));
  expect(options.length).toBeGreaterThan(0);
  expect(options.length).toBeLessThanOrEqual(MAX_ROUTE_CANDIDATES);
  expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  const signatures = options.map((o) =>
    o.legs.map((l) => `${l.mode}:${l.fromStationId}>${l.toStationId}:${l.lineId}`).join(","),
  );
  expect(new Set(signatures).size).toBe(options.length);
  for (const option of options) {
    expect(RouteOptionSchema.safeParse(option).success).toBe(true);
    expect(option.arrivalTime).toBe(computeArrival(departureTime, option.legs));
    const walk = option.legs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.minutes, 0);
    expect(option.walkMinutes).toBe(walk);
    expect(option.fareYen).toBeNull();
    for (const leg of option.legs) {
      expect(stationIds.has(leg.fromStationId ?? "")).toBe(true);
      expect(stationIds.has(leg.toStationId ?? "")).toBe(true);
      if (leg.mode === "ride" || leg.mode === "wait") expect(leg.lineId).toBeDefined();
    }
  }
}

describe("LineType の一本化", () => {
  it("geo の LINE_TYPES は schema のものと同じ", () => {
    expect(LINE_TYPES).toBe(SCHEMA_LINE_TYPES);
  });
});

describe("resolveStationId", () => {
  it("路線の通称で同名の駅を選び分ける", () => {
    expect(router.resolveStationId("京都", "JR京都線")).toBe("jr-west.東海道線.京都");
    expect(router.resolveStationId("京都", "近鉄京都線")).toBe("kintetsu.京都線.京都");
    expect(router.resolveStationId("神戸三宮", "阪神")).toBe("hanshin.本線.神戸三宮");
    expect(router.resolveStationId("岡本", "阪急神戸線")).toBe("hankyu.神戸線.岡本");
  });

  it("路線 ID でも選べる", () => {
    expect(router.resolveStationId("高槻", "jr-west.東海道線")).toBe("jr-west.東海道線.高槻");
  });

  it("路線の指定がなければ乗降客数の多い駅を返す", () => {
    expect(router.resolveStationId("大阪")).not.toBeNull();
  });

  it("見つからない駅名には null を返す", () => {
    expect(router.resolveStationId("存在しない駅名")).toBeNull();
  });
});

describe("findAlternativeRoutes: JR京都線 高槻〜山崎が止まったとき", () => {
  const section = buildSection("jr-west.東海道線", "高槻", "山崎");
  const input: FindAlternativeRoutesInput = {
    originStationId: resolveStation("大阪", "JR京都線"),
    destinationStationId: resolveStation("京都", "JR京都線"),
    blockedSection: section,
    departureTime: DAYTIME,
    transferServiceActive: true,
  };
  const options = router.findAlternativeRoutes(input);

  it("大阪 → 京都 の候補に阪急京都線か京阪の経路が入る", () => {
    const lineIds = options.flatMap(listRideLineIds);
    expect(lineIds.some((id) => id === "hankyu.京都線" || id === "keihan.京阪本線")).toBe(true);
  });

  it("どの候補も止まっている区間を通らない", () => {
    for (const option of options) {
      for (const leg of option.legs) expect(checkCoversSection(leg, section)).toBe(false);
    }
  });

  it("候補は整合し、重複しない", () => {
    expectConsistentOptions(options, DAYTIME);
  });

  it("別の路線を使う候補は振替輸送として扱う", () => {
    for (const option of options) {
      expect(option.kind).toBe("transfer");
      expect(option.isTransferService).toBe(true);
      expect(option.label).toMatch(/で振替$/);
    }
  });

  it("候補ごとに主な路線が異なる", () => {
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
  });

  it("振替輸送がなければ isTransferService は false", () => {
    const noService = router.findAlternativeRoutes({ ...input, transferServiceActive: false });
    for (const option of noService) {
      expect(option.isTransferService).toBe(false);
      expect(option.label).toMatch(/経由$/);
    }
  });

  it("乗換を減らしたい場合、最初の候補の乗車回数は増えない", () => {
    const count = (o: RouteOption | undefined) => (o ? listRideLineIds(o).length : 0);
    const fewer = router.findAlternativeRoutes({
      ...input,
      constraints: { reduceTransfers: true },
    });
    expect(count(fewer[0])).toBeLessThanOrEqual(count(options[0]));
  });
});

describe("findAlternativeRoutes: 阪急神戸線 岡本〜御影が止まったとき", () => {
  const section = buildSection("hankyu.神戸線", "岡本", "御影");
  const options = router.findAlternativeRoutes({
    originStationId: resolveStation("西宮北口", "阪急神戸線"),
    destinationStationId: resolveStation("神戸三宮", "阪急神戸線"),
    blockedSection: section,
    departureTime: DAYTIME,
    transferServiceActive: true,
  });

  it("西宮北口 → 神戸三宮 の候補に JR神戸線か阪神の経路が入る", () => {
    const lineIds = options.flatMap(listRideLineIds);
    expect(lineIds.some((id) => id === "jr-west.東海道線" || id === "hanshin.本線")).toBe(true);
  });

  it("どの候補も止まっている区間を通らない", () => {
    for (const option of options) {
      for (const leg of option.legs) expect(checkCoversSection(leg, section)).toBe(false);
    }
  });

  it("候補は整合し、重複しない", () => {
    expectConsistentOptions(options, DAYTIME);
  });
});

describe("findAlternativeRoutes: 区間を止めないとき", () => {
  const options = router.findAlternativeRoutes({
    originStationId: resolveStation("大阪", "JR京都線"),
    destinationStationId: resolveStation("京都", "JR京都線"),
    blockedSection: null,
    departureTime: DAYTIME,
    transferServiceActive: false,
  });

  it("最短経路は JR京都線の直通になる", () => {
    const first = options[0];
    expect(first?.legs.map((l) => l.mode)).toEqual(["wait", "ride"]);
    expect(listRideLineIds(first as RouteOption)).toEqual(["jr-west.東海道線"]);
    expect(first?.isTransferService).toBe(false);
  });

  it("候補は到着の早い順で整合する", () => {
    expectConsistentOptions(options, DAYTIME);
    const times = options.map((o) => Date.parse(o.arrivalTime));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("深夜は運転間隔が長いので到着が遅くなる", () => {
    const late = router.findAlternativeRoutes({
      originStationId: resolveStation("大阪", "JR京都線"),
      destinationStationId: resolveStation("京都", "JR京都線"),
      blockedSection: null,
      departureTime: LATE_NIGHT,
      transferServiceActive: false,
    });
    const minutesOf = (o: RouteOption | undefined) =>
      o ? o.legs.reduce((s, l) => s + l.minutes, 0) : 0;
    expect(minutesOf(late[0])).toBeGreaterThan(minutesOf(options[0]));
  });
});

describe("findAlternativeRoutes: 近距離", () => {
  const input: FindAlternativeRoutesInput = {
    originStationId: resolveStation("梅田", "御堂筋線"),
    destinationStationId: resolveStation("中津", "御堂筋線"),
    blockedSection: null,
    departureTime: DAYTIME,
    transferServiceActive: false,
  };

  it("全区間徒歩の候補が入る", () => {
    const walk = router.findAlternativeRoutes(input).find((o) => o.kind === "walk");
    expect(walk?.legs).toHaveLength(1);
    expect(walk?.walkMinutes).toBe(walk?.legs[0]?.minutes);
    expect(walk?.isTransferService).toBe(false);
  });

  it("徒歩を減らしたい場合は全区間徒歩を外す", () => {
    const options = router.findAlternativeRoutes({
      ...input,
      constraints: { reduceWalking: true },
    });
    expect(options.some((o) => o.kind === "walk")).toBe(false);
  });

  it("出発駅と行き先駅が同じなら候補はない", () => {
    expect(
      router.findAlternativeRoutes({ ...input, destinationStationId: input.originStationId }),
    ).toEqual([]);
  });
});

describe("findAlternativeRoutes: 入力の誤り", () => {
  it("存在しない駅 ID は例外", () => {
    expect(() =>
      router.findAlternativeRoutes({
        originStationId: "no.such.station",
        destinationStationId: resolveStation("京都", "JR京都線"),
        blockedSection: null,
        departureTime: DAYTIME,
        transferServiceActive: false,
      }),
    ).toThrow();
  });
});

describe("buildTaxiOption", () => {
  const base = {
    originStationId: resolveStation("西宮北口", "阪急神戸線"),
    destinationStationId: resolveStation("神戸三宮", "阪急神戸線"),
  };

  it("運賃と所要時間が正で、到着時刻が整合する", () => {
    const taxi = router.buildTaxiOption({ ...base, departureTime: DAYTIME });
    expect(RouteOptionSchema.safeParse(taxi).success).toBe(true);
    expect(taxi.kind).toBe("taxi");
    expect(taxi.fareYen).toBeGreaterThan(0);
    expect(taxi.legs[0]?.minutes).toBeGreaterThan(0);
    expect(taxi.arrivalTime).toBe(computeArrival(DAYTIME, taxi.legs));
    expect(taxi.walkMinutes).toBe(0);
  });

  it("深夜は割増で運賃が高い", () => {
    const day = router.buildTaxiOption({ ...base, departureTime: DAYTIME });
    const night = router.buildTaxiOption({ ...base, departureTime: LATE_NIGHT });
    expect(night.fareYen as number).toBeGreaterThan(day.fareYen as number);
  });
});

describe("再開を待つ選択肢", () => {
  const base = {
    originStationId: resolveStation("大阪", "JR京都線"),
    destinationStationId: resolveStation("京都", "JR京都線"),
    lineId: "jr-west.東海道線",
  };

  it("再開後の乗車時間は最初の待ちを含まない", () => {
    const route = router.computeWaitRouteMinutes({ ...base, departureTime: DAYTIME });
    expect(route?.legs.map((l) => l.mode)).toEqual(["ride"]);
    expect(route?.minutes).toBe(route?.legs[0]?.minutes);
    expect(route?.minutes).toBeGreaterThan(0);
  });

  it("到着時刻は呼び出し側の値を使い、待ちの脚で合計を合わせる", () => {
    const arrivalTime = "2026-11-05T15:30:00+09:00";
    const option = router.buildWaitOption({ ...base, now: DAYTIME, arrivalTime });
    expect(option).not.toBeNull();
    expect(RouteOptionSchema.safeParse(option).success).toBe(true);
    expect(option?.kind).toBe("wait");
    expect(option?.arrivalTime).toBe(arrivalTime);
    expect(option?.legs[0]?.mode).toBe("wait");
    expect(computeArrival(DAYTIME, option?.legs ?? [])).toBe(arrivalTime);
    expect(option?.isTransferService).toBe(false);
  });
});
