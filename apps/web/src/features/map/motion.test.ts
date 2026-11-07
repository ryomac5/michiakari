import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { computeDistanceMeters, type NetworkData } from "@repo/geo";
import network from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { placeEdgeMarker } from "./edge-marker";
import { createMapGeo, type LinesGeoJson } from "./geo-data";
import {
  buildInCarMotion,
  findPointAtFraction,
  MOTION_TIMING,
  measurePathMeters,
  selectMotionPhase,
  slicePathToFraction,
} from "./motion";
import { type Position, resolveStationByName } from "./scene";

// 車内の判断を地図で動かす道筋を、実際の駅と線路の形で確かめる

const lines = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
) as LinesGeoJson;
const geo = createMapGeo(network as unknown as NetworkData, lines);
const tokaido = "jr-west.東海道線";

function findStation(name: string): Position {
  const node = resolveStationByName(geo.index, name, [tokaido]);
  if (!node) throw new Error(`${name} がありません`);
  return [node.lonLat[0], node.lonLat[1]];
}

const osaka = findStation("大阪");
const tsukamoto = findStation("塚本");
const between: Position = [(osaka[0] + tsukamoto[0]) / 2, (osaka[1] + tsukamoto[1]) / 2];

describe("折れ線の割合", () => {
  const path: Position[] = [
    [135, 34.7],
    [135.01, 34.7],
    [135.02, 34.7],
  ];

  it("半分の点は折れ線の中ほどにある", () => {
    const point = findPointAtFraction(path, 0.5);
    expect(point?.[0]).toBeCloseTo(135.01, 5);
  });

  it("割合までの部分は、長さもその割合になる", () => {
    const part = slicePathToFraction(path, 0.25);
    expect(measurePathMeters(part) / measurePathMeters(path)).toBeCloseTo(0.25, 3);
  });

  it("範囲の外の割合は両端に収める", () => {
    expect(findPointAtFraction(path, 2)).toEqual(path[2]);
    expect(findPointAtFraction(path, -1)).toEqual(path[0]);
  });
});

describe("塚本〜大阪の間の車内", () => {
  it("列車は線路の上を大阪まで動き、その先は乗ったまま京都へ光る", () => {
    const motion = buildInCarMotion(geo, {
      here: between,
      alight: osaka,
      lineId: tokaido,
      alightStation: "大阪",
      destination: { kind: "station", name: "京都" },
      afterAlight: null,
    });
    expect(motion.ride.length).toBeGreaterThanOrEqual(2);
    expect(computeDistanceMeters(motion.ride.at(-1) as Position, osaka)).toBeLessThan(600);
    const after = motion.after[0] ?? [];
    expect(after.length).toBeGreaterThan(5);
    expect(computeDistanceMeters(after.at(-1) as Position, findStation("京都"))).toBeLessThan(600);
  });

  it("乗り換えの一手があれば、乗り換え先の路線で行き先まで光らせる", () => {
    const motion = buildInCarMotion(geo, {
      here: between,
      alight: osaka,
      lineId: tokaido,
      alightStation: "大阪",
      destination: { kind: "station", name: "三ノ宮" },
      afterAlight: {
        kind: "transfer",
        text: "大阪に着いたら大阪梅田から阪急神戸線へ",
        line: "阪急神戸線",
        boardStation: "大阪梅田",
        arrivalTime: "2026-11-07T20:30:00+09:00",
      },
    });
    const after = motion.after[0] ?? [];
    expect(after.length).toBeGreaterThan(2);
    // 三ノ宮の名前の駅は阪急に無いので、近くの神戸三宮までを光らせる
    const kobeSannomiya = resolveStationByName(geo.index, "神戸三宮");
    expect(kobeSannomiya).toBeDefined();
    expect(
      computeDistanceMeters(after.at(-1) as Position, kobeSannomiya?.lonLat ?? [0, 0]),
    ).toBeLessThan(600);
  });

  it("タクシーの一手は道を知らないので、降りた後の経路を描かない", () => {
    const motion = buildInCarMotion(geo, {
      here: between,
      alight: osaka,
      lineId: tokaido,
      alightStation: "大阪",
      destination: { kind: "station", name: "京都" },
      afterAlight: {
        kind: "taxi",
        text: "大阪に着いたらタクシーへ",
        line: null,
        boardStation: null,
        arrivalTime: "2026-11-07T20:30:00+09:00",
      },
    });
    expect(motion.after).toEqual([]);
  });
});

describe("動きの段", () => {
  it("列車が動き、降りる印が出て、経路が伸び、終わる", () => {
    expect(selectMotionPhase(0).phase).toBe("ride");
    expect(selectMotionPhase(MOTION_TIMING.ride + 10).phase).toBe("alight");
    expect(selectMotionPhase(MOTION_TIMING.ride + MOTION_TIMING.alight + 10).phase).toBe("route");
    expect(selectMotionPhase(10_000)).toEqual({ phase: "done", progress: 1 });
  });
});

describe("画面の外の行き先の札", () => {
  const view = { left: 0, top: 0, right: 390, bottom: 600 };
  const size = { w: 100, h: 30 };

  it("見える範囲の中なら札を出さない", () => {
    expect(placeEdgeMarker({ x: 200, y: 300 }, view, size)).toBeNull();
  });

  it("右上の外にあれば、札を範囲の内側の縁に置き、右上を向ける", () => {
    const marker = placeEdgeMarker({ x: 2000, y: -500 }, view, size);
    expect(marker).not.toBeNull();
    expect(marker?.x).toBeLessThanOrEqual(view.right - size.w / 2 + 0.01);
    expect(marker?.y).toBeGreaterThanOrEqual(view.top + size.h / 2 - 0.01);
    expect(marker?.angle).toBeLessThan(0);
    expect(marker?.angle).toBeGreaterThan(-90);
  });
});
