import type { NetworkData } from "@repo/geo";
import { createRouter } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import { isLoopAt, listEntryDirections } from "./directions";
import { createEntryData, type EntryLine, findStationChoice, listGroupLines } from "./entry-places";
import {
  buildRouteGlow,
  measurePathMeters,
  planEntrySpans,
  readRouteEnds,
  sliceSecondHalf,
} from "./route-glow";

// 実データで、今いる所から行き先までの乗る区間を決める
const network = networkJson as unknown as NetworkData;
const geo = createMapGeo(network);
const data = createEntryData(geo.nodes, geo.index);
const router = createRouter(network);
const departureTime = "2026-11-07T09:00:00+09:00";

function findLine(stationName: string, observedName: string): EntryLine {
  const group = data.catalog.groupById.get(stationName);
  const line = group
    ? listGroupLines(data, group).find((l) => l.observedName === observedName)
    : null;
  if (!line) throw new Error(`${stationName} の ${observedName} が見つかりません`);
  return line;
}

function station(name: string) {
  const choice = findStationChoice(data, name);
  if (!choice) throw new Error(`${name} が見つかりません`);
  return choice;
}

describe("planEntrySpans", () => {
  const loop = findLine("大阪", "JR環状線");
  const directions = listEntryDirections(data, loop);
  const toward = (name: string) => directions.find((d) => d.label.ja.includes(name)) ?? null;

  it("環状線では、選んだ方面の向きのまま行き先まで回る", () => {
    const plan = (via: string) =>
      planEntrySpans({
        data,
        router,
        line: loop,
        direction: toward(via),
        loopDirections: isLoopAt(data, loop) ? directions : [],
        destination: station("京橋"),
        departureTime,
      });
    const near = plan("鶴橋");
    const far = plan("天王寺");
    expect(near.onDirection).toBe(true);
    expect(far.onDirection).toBe(true);
    expect(far.spans[0]?.points.length).toBeGreaterThan((near.spans[0]?.points.length ?? 0) * 2);
  });

  it("方面の先に行き先が無ければ、乗り換えを含む乗る区間を返す", () => {
    const kyoto = findLine("大阪", "JR京都線");
    const result = planEntrySpans({
      data,
      router,
      line: kyoto,
      direction: listEntryDirections(data, kyoto)[0] ?? null,
      destination: station("北千里"),
      departureTime,
    });
    expect(result.onDirection).toBe(false);
    expect(result.spans.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildRouteGlow", () => {
  it("線の始まりを出発の駅、終わりを行き先の駅にする", () => {
    const glow = buildRouteGlow(
      [
        {
          lineId: "x",
          points: [
            [135.0, 34.0],
            [135.01, 34.0],
            [135.02, 34.0],
          ],
        },
      ],
      undefined,
      new Map([["x", "#123456"]]),
    );
    expect(readRouteEnds(glow)).toEqual({ start: [135.0, 34.0], end: [135.02, 34.0] });
    expect(glow.features[0]?.properties.color).toBe("#123456");
  });

  it("駅の間にいるときは、最初の駅の間の中ほどから始める", () => {
    const glow = buildRouteGlow(
      [
        {
          lineId: "x",
          points: [
            [135.0, 34.0],
            [135.02, 34.0],
            [135.04, 34.0],
          ],
        },
      ],
      undefined,
      new Map(),
      true,
    );
    const start = readRouteEnds(glow)?.start ?? [0, 0];
    expect(start[0]).toBeCloseTo(135.01, 5);
  });
});

describe("sliceSecondHalf", () => {
  it("線の長さの半分の点から後ろを返す", () => {
    const path: [number, number][] = [
      [135.0, 34.0],
      [135.04, 34.0],
    ];
    const half = sliceSecondHalf(path);
    expect(measurePathMeters(half)).toBeCloseTo(measurePathMeters(path) / 2, 0);
    expect(half.at(-1)).toEqual([135.04, 34.0]);
  });
});
