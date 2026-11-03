import type { NetworkData } from "@repo/geo";
import network from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import {
  AUTO_WALK_MINUTES,
  buildAutoFocusArea,
  listOriginGroup,
  MAX_AUTO_STATIONS,
  selectAutoCandidates,
  selectAwayPlacement,
} from "./auto-focus";
import { createMapGeo } from "./geo-data";
import { type Position, resolveStationByName } from "./scene";

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
        expect(c.walkMinutes).toBeLessThanOrEqual(AUTO_WALK_MINUTES);
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
