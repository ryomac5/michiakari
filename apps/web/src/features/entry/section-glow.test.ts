import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo, type LinesGeoJson } from "@/features/map/geo-data";
import { createEntryData, findStationChoice, type Position } from "./entry-places";
import { type GpsChoice, listLineTapChoices } from "./gps-candidates";
import {
  buildSectionGlow,
  buildSegmentPath,
  computePathMidpoint,
  measurePathDistance,
  SECTION_FOCUS_STRENGTH,
  SECTION_REST_STRENGTH,
} from "./map-pick";

// 線を押して出した駅の間の候補を、地図で光らせる形と強さを、実際の駅と線路の形で確かめる

const lines = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
) as LinesGeoJson;
const geo = createMapGeo(networkJson as unknown as NetworkData, lines);
const data = createEntryData(geo.nodes, geo.index);
const loop = "jr-west.大阪環状線";
const kobe = "jr-west.東海道線";

function findPosition(name: string): Position {
  const choice = findStationChoice(data, name);
  if (!choice) throw new Error(`${name} がありません`);
  return [choice.lon, choice.lat];
}

// 大阪〜福島の環状線の中ほどを、寄せた地図（倍率 13.5）で押したときの候補
function listOsakaChoices(): GpsChoice[] {
  const path = buildSegmentPath(
    geo.trackShapes?.get(loop),
    findPosition("大阪"),
    findPosition("福島"),
  );
  const middle = computePathMidpoint(path);
  if (!middle) throw new Error("大阪〜福島の線がありません");
  const metersPerPx = (40_075_016 * Math.cos((middle[1] * Math.PI) / 180)) / (512 * 2 ** 13.5);
  return listLineTapChoices(
    data,
    geo.nodes,
    { lon: middle[0], lat: middle[1] },
    44 * metersPerPx,
    [loop, kobe],
    geo.trackShapes,
  );
}

const strengthOf = (glow: ReturnType<typeof buildSectionGlow>, key: string | undefined) =>
  glow.features.find((f) => f.properties.key === key)?.properties.strength;

describe("buildSectionGlow", () => {
  const choices = listOsakaChoices();
  const [first, second] = choices;

  it("大阪〜福島の候補は 2 件で、どちらも光らせる", () => {
    expect(choices).toHaveLength(2);
    const glow = buildSectionGlow(choices, null, geo.trackShapes);
    expect(glow.features.map((f) => f.properties.key).sort()).toEqual(
      choices.map((c) => c.key).sort(),
    );
  });

  it("注目が無ければ先頭の候補をいちばん強くし、最後に描く", () => {
    const glow = buildSectionGlow(choices, null, geo.trackShapes);
    expect(strengthOf(glow, first?.key)).toBe(SECTION_FOCUS_STRENGTH);
    expect(strengthOf(glow, second?.key)).toBe(SECTION_REST_STRENGTH);
    expect(glow.features.at(-1)?.properties.key).toBe(first?.key);
  });

  it("2 件目に注目すると、強さが入れ替わる", () => {
    const glow = buildSectionGlow(choices, second?.key ?? null, geo.trackShapes);
    expect(strengthOf(glow, second?.key)).toBe(SECTION_FOCUS_STRENGTH);
    expect(strengthOf(glow, first?.key)).toBe(SECTION_REST_STRENGTH);
    expect(glow.features.at(-1)?.properties.key).toBe(second?.key);
  });

  it("候補に無い注目は、先頭の候補を注目にする", () => {
    const glow = buildSectionGlow(choices, "between:none", geo.trackShapes);
    expect(strengthOf(glow, first?.key)).toBe(SECTION_FOCUS_STRENGTH);
  });

  it("形は駅の間で切った線路の形で、両端は 2 駅の近くにあり、色は路線色にする", () => {
    const glow = buildSectionGlow(choices, null, geo.trackShapes);
    for (const choice of choices) {
      if (choice.kind !== "between") continue;
      const feature = glow.features.find((f) => f.properties.key === choice.key);
      const path = feature?.geometry.coordinates ?? [];
      expect(path.length).toBeGreaterThan(2);
      expect(feature?.properties.color).toBe(choice.line.color);
      expect(measurePathDistance([choice.from.lon, choice.from.lat], path)).toBeLessThan(150);
      expect(measurePathDistance([choice.to.lon, choice.to.lat], path)).toBeLessThan(150);
    }
  });

  it("線路の形が無ければ 2 駅を結ぶ", () => {
    const glow = buildSectionGlow(choices.slice(0, 1), null);
    const only = choices[0];
    if (only?.kind !== "between") throw new Error("駅の間ではありません");
    expect(glow.features[0]?.geometry.coordinates).toEqual([
      [only.from.lon, only.from.lat],
      [only.to.lon, only.to.lat],
    ]);
  });

  it("候補が 1 件なら、その区間をいちばん強くする。駅の候補と空の一覧は描かない", () => {
    const glow = buildSectionGlow(choices.slice(0, 1), null, geo.trackShapes);
    expect(glow.features).toHaveLength(1);
    expect(glow.features[0]?.properties.strength).toBe(SECTION_FOCUS_STRENGTH);
    const station = findStationChoice(data, "大阪");
    if (!station) throw new Error("大阪がありません");
    const stationChoice: GpsChoice = {
      kind: "station",
      key: `station:${station.id}`,
      choice: station,
      distanceMeters: 0,
    };
    expect(buildSectionGlow([stationChoice], null, geo.trackShapes).features).toHaveLength(0);
    expect(buildSectionGlow([], null).features).toHaveLength(0);
  });
});
