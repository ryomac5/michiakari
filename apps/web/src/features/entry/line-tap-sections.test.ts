import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type NetworkData, removeDuplicatedStubs, type StationNode } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { buildTrackShapes, createMapGeo, type LinesGeoJson } from "@/features/map/geo-data";
import { createEntryData } from "./entry-places";
import { listLineTapChoices } from "./gps-candidates";
import {
  buildSectionGlow,
  buildSegmentPath,
  computePathMidpoint,
  measurePathDistance,
} from "./map-pick";

// 全路線の駅の間で、描いた線路の形の中ほどを押すと、その駅の間が先頭に出て、その線の上で光るかを確かめる
// 同じ名前の駅をまとめた位置は別の会社の駅のことがあり、光る区間がずれていた（阪急千里線の吹田と JR の吹田など）

const lines = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
) as LinesGeoJson;
const geo = createMapGeo(networkJson as unknown as NetworkData, lines);
const data = createEntryData(geo.nodes, geo.index);
const trackShapes = buildTrackShapes(lines);
const nodeById = new Map(geo.nodes.map((n) => [n.stationId, n]));

type Pair = { lineId: string; from: StationNode; to: StationNode };

// 路線の隣り合う駅の組。環状の区間は末尾から先頭へも結ぶ
function listPairs(): Pair[] {
  return removeDuplicatedStubs(geo.index.listLines(), geo.nodes).flatMap((line) =>
    line.segments.flatMap((segment) => {
      const ids = [...segment.stationIds];
      const pairs = ids.slice(1).map((id, i) => [ids[i], id]);
      if (segment.loop && ids.length > 2) pairs.push([ids.at(-1), ids[0]]);
      return pairs.flatMap(([a, b]) => {
        const from = a ? nodeById.get(a) : undefined;
        const to = b ? nodeById.get(b) : undefined;
        return from && to ? [{ lineId: line.lineId, from, to }] : [];
      });
    }),
  );
}

// 押した点から、いちばん強く光る区間までの距離（m）。先頭の候補が押した駅の間でなければ null
function measureTap(pair: Pair, reachMeters: number): number | null {
  const path = buildSegmentPath(
    trackShapes.get(pair.lineId),
    [...pair.from.lonLat],
    [...pair.to.lonLat],
  );
  const middle = computePathMidpoint(path);
  if (!middle) return null;
  const choices = listLineTapChoices(
    data,
    geo.nodes,
    { lon: middle[0], lat: middle[1] },
    reachMeters,
    [pair.lineId],
    trackShapes,
  );
  const [first] = choices;
  const names = first?.kind === "between" ? [first.from.name, first.to.name].sort() : [];
  if (names.join("|") !== [pair.from.name, pair.to.name].sort().join("|")) return null;
  const glow = buildSectionGlow(choices, null, trackShapes).features.at(-1);
  return glow ? measurePathDistance(middle, glow.geometry.coordinates) : null;
}

describe("全路線の駅の間を押したときの候補と光り", () => {
  const pairs = listPairs();

  it("駅の間を 1000 組より多く調べる", () => {
    expect(pairs.length).toBeGreaterThan(1000);
  });

  // 寄った地図の 44px（約100m）と、開いた直後の 44px（約4500m）
  for (const reach of [100, 4500]) {
    it(`押せる幅 ${reach}m で、先頭に押した駅の間が出て、押した点の 30m の内で光る`, () => {
      const mismatched = pairs.flatMap((pair) => {
        const meters = measureTap(pair, reach);
        return meters !== null && meters <= 30
          ? []
          : [`${pair.lineId} ${pair.from.name}〜${pair.to.name}`];
      });
      expect(mismatched).toEqual([]);
    });
  }
});
