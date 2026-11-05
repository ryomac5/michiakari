import { ACCESS_WALK_MAX_MINUTES, estimateWalkMinutes } from "@repo/core";
import type { NetworkData } from "@repo/geo";
import { computeDistanceMeters, listWalkAccessStations } from "@repo/geo";
import network from "@repo/geo/data/network.json";
import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { focusAreas, MAX_FOCUS_STATIONS } from "./focus-areas";
import { createMapGeo } from "./geo-data";
import { resolveStationByName } from "./scene";
import {
  buildStationGuide,
  findFocusArea,
  findPointAtDistance,
  findRingLabelPoint,
  type StationGuideInput,
} from "./station-guide";

const geo = createMapGeo(network as unknown as NetworkData);
const tokaido = "jr-west.東海道線";

// 主役シナリオの判断に出る選択肢を短くしたもの（駅 ID は agent が返す形）
const waitOption: RouteOption = {
  id: "wait",
  kind: "wait",
  label: "JR京都線の運転再開を待つ",
  arrivalTime: "2026-11-05T23:50:00+09:00",
  fareYen: null,
  walkMinutes: 0,
  isTransferService: false,
  legs: [
    {
      mode: "ride",
      from: "大阪",
      to: "京都",
      minutes: 43,
      line: "JR京都線",
      fromStationId: "jr-west.東海道線.大阪",
      toStationId: "jr-west.東海道線.京都",
      lineId: tokaido,
    } as RouteOption["legs"][number],
  ],
};

const metroOption: RouteOption = {
  id: "transfer_1",
  kind: "transfer",
  label: "阪急京都線で振替",
  arrivalTime: "2026-11-06T00:22:00+09:00",
  fareYen: null,
  walkMinutes: 16,
  isTransferService: true,
  legs: [
    {
      mode: "walk",
      from: "大阪",
      to: "梅田",
      minutes: 6,
      fromStationId: "jr-west.東海道線.大阪",
      toStationId: "osaka-metro.御堂筋線.梅田",
    },
    {
      mode: "ride",
      from: "梅田",
      to: "西中島南方",
      minutes: 6,
      line: "地下鉄御堂筋線",
      fromStationId: "osaka-metro.御堂筋線.梅田",
      toStationId: "osaka-metro.御堂筋線.西中島南方",
      lineId: "osaka-metro.御堂筋線",
    },
    {
      mode: "ride",
      from: "南方",
      to: "烏丸",
      minutes: 52,
      line: "阪急京都線",
      fromStationId: "hankyu.京都線.南方",
      toStationId: "hankyu.京都線.烏丸",
      lineId: "hankyu.京都線",
    },
  ] as RouteOption["legs"],
};

const loopOption: RouteOption = {
  id: "transfer_2",
  kind: "transfer",
  label: "京阪本線で振替",
  arrivalTime: "2026-11-06T00:30:00+09:00",
  fareYen: null,
  walkMinutes: 14,
  isTransferService: true,
  legs: [
    {
      mode: "walk",
      from: "大阪",
      to: "大阪",
      minutes: 3,
      fromStationId: "jr-west.東海道線.大阪",
      toStationId: "jr-west.大阪環状線.大阪",
    },
    {
      mode: "ride",
      from: "大阪",
      to: "京橋",
      minutes: 7,
      line: "JR環状線",
      fromStationId: "jr-west.大阪環状線.大阪",
      toStationId: "jr-west.大阪環状線.京橋",
      lineId: "jr-west.大阪環状線",
    },
  ] as RouteOption["legs"],
};

// 大阪梅田まで歩き、阪急京都線に乗る選択肢（網の補正で足した京都線の大阪梅田から乗る）
const hankyuOption: RouteOption = {
  id: "transfer_hankyu",
  kind: "transfer",
  label: "阪急京都線で振替",
  arrivalTime: "2026-11-06T00:20:00+09:00",
  fareYen: null,
  walkMinutes: 9,
  isTransferService: true,
  legs: [
    {
      mode: "walk",
      from: "大阪",
      to: "大阪梅田",
      minutes: 9,
      fromStationId: "jr-west.東海道線.大阪",
      toStationId: "hankyu.京都線.大阪梅田",
    },
    {
      mode: "ride",
      from: "大阪梅田",
      to: "烏丸",
      minutes: 57,
      line: "阪急京都線",
      fromStationId: "hankyu.京都線.大阪梅田",
      toStationId: "hankyu.京都線.烏丸",
      lineId: "hankyu.京都線",
    },
  ] as RouteOption["legs"],
};

function buildInput(overrides: Partial<StationGuideInput> = {}): StationGuideInput {
  return {
    origin: { kind: "station", name: "大阪" },
    options: [waitOption, metroOption, loopOption],
    recommendedOptionId: "transfer_1",
    blockedLineIds: [tokaido],
    blockedLineName: "JR京都線",
    language: "ja",
    formatWalk: (minutes) => `徒歩 ${minutes} 分`,
    ...overrides,
  };
}

function buildGuide(overrides: Partial<StationGuideInput> = {}) {
  const input = buildInput(overrides);
  const area = findFocusArea(input.origin);
  if (!area) throw new Error("大阪の範囲がありません");
  const guide = buildStationGuide(geo, area, input);
  if (!guide) throw new Error("案内を組み立てられません");
  return guide;
}

describe("findFocusArea", () => {
  it("大阪駅を現在地にしたときだけ梅田一帯を返す", () => {
    expect(findFocusArea({ kind: "station", name: "大阪" })?.id).toBe("umeda");
    expect(findFocusArea({ kind: "station", name: "大阪駅" })?.id).toBe("umeda");
    expect(findFocusArea({ kind: "station", name: "三ノ宮" })).toBeNull();
    expect(findFocusArea({ kind: "coord", lon: 135.5, lat: 34.7 })).toBeNull();
  });
});

describe("手で整えた範囲の吹き出し", () => {
  it("どの駅も、代替手段の探索が通常の上限の中で乗る駅の候補にする駅に入る", () => {
    for (const area of focusAreas) {
      const origin = resolveStationByName(geo.index, area.originNames[0] as string, [tokaido]);
      if (!origin) throw new Error(`${area.id} の現在地がありません`);
      const searchable = new Set(
        listWalkAccessStations({
          nodes: geo.nodes,
          graph: geo.graph,
          origin,
          blockedLineIds: [tokaido],
          maxWalkMinutes: ACCESS_WALK_MAX_MINUTES,
        }).map((w) => w.station.stationId),
      );
      for (const station of area.stations) {
        expect(
          station.stationIds.some((id) => searchable.has(id)),
          `${area.id}/${station.key}`,
        ).toBe(true);
      }
    }
  });
});

describe("buildStationGuide", () => {
  it("選択肢が最初に乗る駅を先に、多くても決めた数だけ出す", () => {
    const guide = buildGuide();
    expect(guide.stations.length).toBeLessThanOrEqual(MAX_FOCUS_STATIONS);
    expect(guide.stations[0]?.key).toBe("metro-umeda");
    expect(guide.stations.map((s) => s.key)).toContain("hankyu-umeda");
  });

  it("推奨の選択肢が最初に乗る駅だけにおすすめの印を付け、押すとその選択肢へ移る", () => {
    const guide = buildGuide();
    const recommended = guide.stations.filter((s) => s.recommended);
    expect(recommended.map((s) => s.key)).toEqual(["metro-umeda"]);
    expect(recommended[0]?.optionId).toBe("transfer_1");
    const waiting = buildGuide({ recommendedOptionId: "wait" });
    expect(waiting.stations.some((s) => s.recommended)).toBe(false);
  });

  it("徒歩の分数は選択肢の徒歩区間、乗換の徒歩、core の概算の順に使う", () => {
    const guide = buildGuide();
    const byKey = new Map(guide.stations.map((s) => [s.key, s]));
    expect(byKey.get("metro-umeda")).toMatchObject({ walkMinutes: 6, walkSource: "option" });
    // 路線データの乗換の徒歩（東海道線の大阪 → 阪急の大阪梅田）
    expect(byKey.get("hankyu-umeda")).toMatchObject({ walkSource: "transfer" });
    const kitashinchi = byKey.get("kitashinchi");
    expect(kitashinchi?.walkSource).toBe("estimate");
    const origin = geo.index.getStation("jr-west.東海道線.大阪");
    const station = geo.index.getStation("jr-west.JR東西線.北新地");
    if (!origin || !station) throw new Error("駅がありません");
    expect(kitashinchi?.walkMinutes).toBe(estimateWalkMinutes(origin.lonLat, station.lonLat));
  });

  it("止まっている路線を見合わせ、振替の選択肢の名前の路線が出る駅だけを振替の対象にする", () => {
    const guide = buildGuide();
    const byKey = new Map(guide.stations.map((s) => [s.key, s]));
    // 御堂筋線は阪急京都線へ乗り継ぐためだけに使うので、振替の対象にしない
    expect(byKey.get("metro-umeda")?.transferService).toBe(false);
    expect(byKey.get("hankyu-umeda")?.transferService).toBe(true);
    const kyoto = byKey.get("hankyu-umeda")?.lines.find((l) => l.lineId === "hankyu.京都線");
    expect(kyoto?.transferService).toBe(true);
    expect(byKey.get("hanshin-umeda")?.transferService).toBe(false);
    expect(byKey.get("metro-umeda")?.suspended).toBe(false);
    const here = guide.here.lines.find((l) => l.lineId === tokaido);
    expect(here).toMatchObject({ name: "JR京都線", suspended: true, transferService: false });
    expect(guide.here.lines[0]?.suspended).toBe(true);
  });

  it("推奨が乗り継ぐなら、おすすめの吹き出しに最初の路線と、結論の路線への乗り継ぎを 2 段で持たせる", () => {
    const metro = buildGuide().stations.find((s) => s.key === "metro-umeda");
    expect(metro?.route?.first.name).toBe("地下鉄御堂筋線");
    expect(metro?.route?.via).toMatchObject({
      stationName: "南方",
      line: { name: "阪急京都線", transferService: true },
    });
    const others = buildGuide().stations.filter((s) => s.key !== "metro-umeda");
    expect(others.every((s) => s.route === null)).toBe(true);
  });

  it("大阪梅田から阪急京都線に乗る推奨では、阪急の吹き出しがおすすめになり、京都線を先頭に置く", () => {
    const guide = buildGuide({
      options: [waitOption, hankyuOption, metroOption],
      recommendedOptionId: "transfer_hankyu",
    });
    const hankyu = guide.stations.find((s) => s.key === "hankyu-umeda");
    expect(hankyu).toMatchObject({
      recommended: true,
      optionId: "transfer_hankyu",
      walkMinutes: 9,
    });
    expect(hankyu?.lines[0]?.name).toBe("阪急京都線");
    expect(hankyu?.route).toMatchObject({ first: { name: "阪急京都線" }, via: null });
    expect(guide.stations.filter((s) => s.recommended)).toHaveLength(1);
  });

  it("振替輸送がまだ無い判断では、振替の印を付けない", () => {
    const guide = buildGuide({
      options: [waitOption, { ...metroOption, isTransferService: false }],
      recommendedOptionId: null,
    });
    expect(guide.stations.some((s) => s.transferService)).toBe(false);
  });

  it("阪急の大阪梅田には、網の補正で足した京都線も乗れる路線として出す", () => {
    const hankyu = buildGuide().stations.find((s) => s.key === "hankyu-umeda");
    expect(hankyu?.lines.map((l) => l.name)).toContain("阪急京都線");
  });

  it("英語では駅名・路線名を英語にし、英語名の無い通称は路線データの英語名にする", () => {
    const guide = buildGuide({ language: "en", formatWalk: (m) => `${m} min walk` });
    expect(guide.here.name).toBe("Osaka Sta.");
    expect(guide.here.lines.find((l) => l.suspended)?.name).toBe("JR Tokaido Line");
    expect(guide.stations[0]).toMatchObject({ name: "Umeda", operator: "Osaka Metro" });
    expect(guide.walkLabels.features[0]?.properties.label).toBe("6 min walk");
  });

  it("推奨が現在地の駅で乗る路線なら、現在地の札のその路線に印を付ける", () => {
    const guide = buildGuide({ recommendedOptionId: "transfer_2" });
    expect(guide.here.recommendedLineId).toBe("jr-west.大阪環状線");
    expect(guide.stations.some((s) => s.recommended)).toBe(false);
  });

  it("徒歩の道と札は駅ごとに 1 本ずつで、寄せる範囲は現在地と駅を含む", () => {
    const guide = buildGuide();
    expect(guide.walkPaths.features).toHaveLength(guide.stations.length);
    expect(guide.walkLabels.features).toHaveLength(guide.stations.length);
    const [[west, south], [east, north]] = guide.bounds as [[number, number], [number, number]];
    for (const p of [guide.here.position, ...guide.stations.map((s) => s.position)]) {
      expect(p[0]).toBeGreaterThanOrEqual(west);
      expect(p[0]).toBeLessThanOrEqual(east);
      expect(p[1]).toBeGreaterThanOrEqual(south);
      expect(p[1]).toBeLessThanOrEqual(north);
    }
    expect(guide.relevantLineIds).toContain("osaka-metro.御堂筋線");
  });
});

describe("findPointAtDistance", () => {
  const path: [number, number][] = [
    [135.5, 34.7],
    [135.5, 34.71],
    [135.51, 34.71],
  ];
  it("起点からの直線距離が初めて指定の距離になる点を、折れ線の上で返す", () => {
    const point = findPointAtDistance(path, [135.5, 34.7], 500);
    if (!point) throw new Error("点がありません");
    expect(computeDistanceMeters(point, [135.5, 34.7])).toBeCloseTo(500, 0);
    expect(point[0]).toBeCloseTo(135.5, 6);
  });

  it("届かなければ終点を返し、空なら null", () => {
    expect(findPointAtDistance(path, [135.5, 34.7], 50_000)).toEqual([135.51, 34.71]);
    expect(findPointAtDistance([], [135.5, 34.7], 100)).toBeNull();
  });
});

describe("findRingLabelPoint", () => {
  const center: [number, number] = [135.5, 34.7];
  const ring: [number, number][] = [
    [135.5, 34.71],
    [135.51, 34.7],
    [135.5, 34.69],
    [135.49, 34.7],
  ];
  it("指定の方位に最も張り出した頂点を返す", () => {
    expect(findRingLabelPoint(ring, center, 0)).toEqual([135.5, 34.71]);
    expect(findRingLabelPoint(ring, center, 90)).toEqual([135.51, 34.7]);
    expect(findRingLabelPoint(ring, center, 180)).toEqual([135.5, 34.69]);
    expect(findRingLabelPoint([], center, 0)).toBeNull();
  });
});
