import { ACCESS_WALK_MAX_MINUTES, ACCESS_WALK_MAX_MINUTES_EXTENDED } from "@repo/core";
import { createRouter, listWalkAccessStations, type NetworkData } from "@repo/geo";
import network from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import {
  buildAutoFocusArea,
  listOriginGroup,
  listPickableWalkStations,
  MAX_AUTO_STATIONS,
  selectAutoCandidates,
  selectAwayPlacement,
} from "./auto-focus";
import { createMapGeo } from "./geo-data";
import { type Position, resolveStationByName } from "./scene";
import { listBoardingStationIds } from "./station-guide";

// 手で整えた範囲が無い駅で、乗り換え候補の駅を実データから選べるか確かめる
const geo = createMapGeo(network as unknown as NetworkData);
const midosuji = "osaka-metro.御堂筋線";

function positionOf(name: string): Position {
  const node = resolveStationByName(geo.index, name);
  if (!node) throw new Error(`${name} がありません`);
  return [node.lonLat[0], node.lonLat[1]];
}

function candidatesAt(stationName: string, destination: string) {
  const origin = resolveStationByName(geo.index, stationName, [midosuji]);
  if (!origin) throw new Error(`${stationName} がありません`);
  return selectAutoCandidates(geo, {
    origin,
    blockedLineIds: [midosuji],
    destination: positionOf(destination),
  });
}

describe("selectAutoCandidates", () => {
  for (const [station, destination] of [
    ["心斎橋", "新大阪"],
    ["本町", "新大阪"],
    ["難波", "梅田"],
  ] as const) {
    it(`${station}の御堂筋線では、御堂筋線の駅を含まず 4 駅以内の徒歩圏の駅を選ぶ`, () => {
      const candidates = candidatesAt(station, destination);
      const origin = resolveStationByName(geo.index, station, [midosuji]);
      if (!origin) throw new Error(`${station} がありません`);
      const originIds = new Set(listOriginGroup(geo, origin).map((n) => n.stationId));
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(MAX_AUTO_STATIONS);
      for (const c of candidates) {
        expect(c.lineIds).not.toContain(midosuji);
        expect(c.stationIds.some((id) => id.startsWith(`${midosuji}.`))).toBe(false);
        expect(c.walkMinutes).toBeLessThanOrEqual(ACCESS_WALK_MAX_MINUTES);
        // 現在地の駅そのものは吹き出しにしない
        expect(c.stationIds.some((id) => originIds.has(id))).toBe(false);
      }
    });
  }

  it("心斎橋から新大阪へは、北へ向かえる路線の駅を先に出す", () => {
    const [first] = candidatesAt("心斎橋", "新大阪");
    expect(first?.progress ?? 0).toBeGreaterThan(0.5);
  });

  it("選択肢が最初に乗る駅は、ほかの駅より先に出す", () => {
    const origin = resolveStationByName(geo.index, "心斎橋", [midosuji]);
    if (!origin) throw new Error("心斎橋がありません");
    const base = selectAutoCandidates(geo, {
      origin,
      blockedLineIds: [midosuji],
      destination: positionOf("新大阪"),
    });
    const last = base.at(-1);
    if (!last) throw new Error("候補がありません");
    const boarded = selectAutoCandidates(geo, {
      origin,
      blockedLineIds: [midosuji],
      destination: positionOf("新大阪"),
      boardingIds: new Set([last.stationIds[0] as string]),
    });
    expect(boarded[0]?.stationIds).toEqual(last.stationIds);
  });
});

describe("塚本: 別の鉄道の駅まで歩いて 20 分以上かかる駅", () => {
  const tokaido = "jr-west.東海道線";
  const origin = resolveStationByName(geo.index, "塚本", [tokaido]);
  if (!origin) throw new Error("塚本がありません");
  const base = { origin, blockedLineIds: [tokaido], destination: positionOf("三ノ宮") };

  it("通常の上限の中に駅が無いので、広げた上限までの駅を吹き出しの候補にする", () => {
    const candidates = selectAutoCandidates(geo, base);
    expect(new Set(candidates.map((c) => c.name.ja))).toEqual(new Set(["御幣島", "姫島", "十三"]));
    for (const c of candidates) {
      expect(c.walkMinutes).toBeGreaterThan(ACCESS_WALK_MAX_MINUTES);
      expect(c.walkMinutes).toBeLessThanOrEqual(ACCESS_WALK_MAX_MINUTES_EXTENDED);
    }
  });

  it("吹き出しの候補は、代替手段の探索が乗る駅の候補にする駅の中から選ぶ", () => {
    const searchable = new Set(
      listWalkAccessStations({
        nodes: geo.nodes,
        graph: geo.graph,
        origin,
        blockedLineIds: [tokaido],
        maxWalkMinutes: ACCESS_WALK_MAX_MINUTES_EXTENDED,
      }).map((w) => w.station.stationId),
    );
    for (const c of selectAutoCandidates(geo, base)) {
      for (const id of c.stationIds) expect(searchable.has(id)).toBe(true);
    }
  });

  it("探索が返す経路の最初に乗る駅は、すべて吹き出しの候補に入る。探索が候補にした御幣島も出る", () => {
    const router = createRouter(network as unknown as NetworkData);
    const originId = router.resolveStationId("塚本", "JR神戸線");
    const destinationId = router.resolveStationId("三ノ宮", "JR神戸線");
    const fromId = router.resolveStationId("大阪", "JR神戸線");
    if (!originId || !destinationId || !fromId) throw new Error("駅がありません");
    const options = router.findAlternativeRoutes({
      originStationId: originId,
      destinationStationId: destinationId,
      blockedSection: { lineId: tokaido, fromStationId: fromId, toStationId: destinationId },
      departureTime: "2026-11-05T22:13:00+09:00",
      transferServiceActive: false,
    });
    const boardingIds = listBoardingStationIds(options);
    expect(boardingIds.size).toBeGreaterThan(0);
    const picked = selectAutoCandidates(geo, { ...base, boardingIds });
    const pickedIds = new Set(picked.flatMap((c) => c.stationIds));
    for (const id of boardingIds) expect(pickedIds.has(id)).toBe(true);
    expect(picked.map((c) => c.name.ja)).toContain("御幣島");
  });

  it("通常の上限の中に駅があるなら、広げた上限の駅は出さない", () => {
    const shinsaibashi = resolveStationByName(geo.index, "心斎橋", [midosuji]);
    if (!shinsaibashi) throw new Error("心斎橋がありません");
    const stations = listPickableWalkStations(geo, {
      origin: shinsaibashi,
      blockedLineIds: [midosuji],
    });
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((w) => w.walkMinutes <= ACCESS_WALK_MAX_MINUTES)).toBe(true);
  });
});

describe("listPickableWalkStations: 上限を広げた探索かどうかの見分け", () => {
  // JR の宝塚から阪急の宝塚南口へは、路線データの乗換の辺があり 17 分。清荒神は辺が無く、概算で 19 分
  const fukuchiyama = "jr-west.福知山線";
  const origin = resolveStationByName(geo.index, "宝塚", [fukuchiyama]);
  if (!origin || origin.lineId !== fukuchiyama) throw new Error("JR の宝塚がありません");
  const base = { origin, blockedLineIds: [fukuchiyama] };

  it("乗換の辺で結ばれた駅から乗る選択肢は、通常の探索が使うので、広げた探索とみなさない", () => {
    const stations = listPickableWalkStations(geo, {
      ...base,
      boardingIds: new Set(["hankyu.今津線.宝塚南口"]),
    });
    const names = stations.map((w) => w.station.name);
    expect(names).toContain("宝塚南口");
    expect(names).not.toContain("清荒神");
  });

  it("辺が無い駅から乗る選択肢があれば、広げた探索とみなし、広げた上限までの駅を出す", () => {
    const stations = listPickableWalkStations(geo, {
      ...base,
      boardingIds: new Set(["hankyu.宝塚線.清荒神"]),
    });
    const names = stations.map((w) => w.station.name);
    expect(names).toContain("清荒神");
    expect(names).toContain("宝塚南口");
  });
});

describe("buildAutoFocusArea", () => {
  it("手で整えた範囲と同じ形にし、吹き出しの key と現在地の名前を持つ", () => {
    const area = buildAutoFocusArea(geo, {
      origin: { kind: "station", name: "心斎橋" },
      blockedLineIds: [midosuji],
      destination: positionOf("新大阪"),
    });
    expect(area?.auto).toBe(true);
    expect(area?.id).toBe("auto:心斎橋");
    expect(area?.hereName.ja).toBe("心斎橋");
    expect(area?.stations.length).toBeGreaterThan(0);
    expect(new Set(area?.stations.map((s) => s.key)).size).toBe(area?.stations.length);
  });

  it("駅でない現在地では組み立てない", () => {
    expect(
      buildAutoFocusArea(geo, {
        origin: { kind: "coord", lon: 135.5, lat: 34.67 },
        blockedLineIds: [],
        destination: null,
      }),
    ).toBeNull();
  });
});

describe("selectAwayPlacement", () => {
  it("現在地から離れる向きに置く", () => {
    const here: Position = [135.5, 34.7];
    expect(selectAwayPlacement(here, [135.51, 34.7])).toBe("right");
    expect(selectAwayPlacement(here, [135.49, 34.7])).toBe("left");
    expect(selectAwayPlacement(here, [135.5, 34.71])).toBe("top");
    expect(selectAwayPlacement(here, [135.5, 34.69])).toBe("bottom");
  });
});
