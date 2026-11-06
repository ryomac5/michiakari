import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { projectToWorld, type ScreenPoint } from "@/features/map/bubble-layout";
import { createMapGeo, type LinesGeoJson } from "@/features/map/geo-data";
import { createEntryData, findStationChoice, type Position } from "./entry-places";
import { listLineTapChoices } from "./gps-candidates";
import {
  buildSegmentPath,
  computePathMidpoint,
  LABEL_RAIL_TAP_PX,
  type ScreenRail,
  selectMapTapTarget,
} from "./map-pick";
import { listMapStations, selectVisibleStations, type VisibleStation } from "./visible-stations";

// 寄せた地図で、駅の印の中心を押すと駅、描いた線の中ほどを押すと駅の間になるかを、実際の駅と線路の形で確かめる

const lines = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
) as LinesGeoJson;
const geo = createMapGeo(networkJson as unknown as NetworkData, lines);
const data = createEntryData(geo.nodes, geo.index);
const stations = listMapStations(data);
// 375×667 の画面で、上部の帯とシートを除いた地図の範囲
const view = { width: 375, height: 400 };
const loop = "jr-west.大阪環状線";
const kobe = "jr-west.東海道線";

// center を画面の中央に置いたときの、画面の点に直す関数
function buildProjector(center: Position, zoom: number) {
  const origin = projectToWorld(center, zoom);
  return (p: Position): ScreenPoint => {
    const world = projectToWorld(p, zoom);
    return { x: world.x - origin.x + view.width / 2, y: world.y - origin.y + view.height / 2 };
  };
}

function findPosition(name: string): Position {
  const choice = findStationChoice(data, name);
  if (!choice) throw new Error(`${name} がありません`);
  return [choice.lon, choice.lat];
}

// 2 駅の間を、描いている線路の形に沿って切り出した中ほどの点
function findTrackMidpoint(lineId: string, from: string, to: string): Position {
  const path = buildSegmentPath(geo.trackShapes?.get(lineId), findPosition(from), findPosition(to));
  const middle = computePathMidpoint(path);
  if (!middle) throw new Error(`${from}〜${to} の線がありません`);
  return middle;
}

// 画面に描く全部の路線を、画面の点の折れ線にする
function buildScreenRails(project: (p: Position) => ScreenPoint): ScreenRail[] {
  return lines.features.map((f) => ({
    lineId: f.properties.lineId,
    paths: (f.geometry.type === "LineString"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates
    ).map((path) => (path as Position[]).map(project)),
  }));
}

function buildScene(center: Position, zoom: number) {
  const project = buildProjector(center, zoom);
  const visible = selectVisibleStations({
    stations,
    zoom,
    view: { left: 0, top: 0, right: view.width, bottom: view.height },
    project,
    locale: "ja",
  });
  const tap = (position: Position, label: VisibleStation | null = null) =>
    selectMapTapTarget({
      point: project(position),
      stations: visible.map((v) => ({
        key: v.place.key,
        point: project(v.place.position),
        markRadius: v.markRadius,
        hitRadius: v.hitRadius,
      })),
      rails: buildScreenRails(project),
      labelKey: label?.place.key ?? null,
    });
  const placeOf = (name: string) => {
    const found = visible.find((v) => v.place.name.ja === name);
    if (!found) throw new Error(`${name} の印がありません`);
    return found;
  };
  // 押した点の駅の間を、最初の段と同じ関数で候補にする。reach は 44px を m に直した値
  const listChoicesAt = (position: Position, lineIds: string[]) => {
    const metersPerPx = (40_075_016 * Math.cos((position[1] * Math.PI) / 180)) / (512 * 2 ** zoom);
    return listLineTapChoices(
      data,
      geo.nodes,
      { lon: position[0], lat: position[1] },
      44 * metersPerPx,
      lineIds,
    );
  };
  return { project, visible, tap, placeOf, listChoicesAt };
}

describe("selectMapTapTarget", () => {
  describe.each([
    // 駅の間は約 1km。駅の間の段の倍率で、描いた線の中ほどを押す
    {
      name: "大阪〜福島の JR環状線",
      lineId: loop,
      from: "大阪",
      to: "福島",
      label: "JR環状線",
      zoom: 13.5,
      middle: findTrackMidpoint(loop, "大阪", "福島"),
    },
    // 駅の間は約 4km。両方の駅が入る倍率にする。描いた線の中ほどは JR東西線の加島の印のそばなので
    // 描いた JR神戸線の上で、ほかの路線の線から約 700m 離れた点を押す
    {
      name: "塚本〜尼崎の JR神戸線",
      lineId: kobe,
      from: "塚本",
      to: "尼崎",
      label: "JR神戸線",
      zoom: 12.6,
      middle: [135.463484, 34.718828] as Position,
    },
  ])("$name", ({ lineId, from, to, label, zoom, middle }) => {
    const [a, b] = [findPosition(from), findPosition(to)];
    const scene = buildScene([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom);

    it("駅の印の中心を押すと、その駅を選ぶ", () => {
      for (const name of [from, to]) {
        const place = scene.placeOf(name);
        expect(scene.tap(place.place.position)).toEqual({ kind: "station", key: place.place.key });
      }
    });

    it("印は見た目の丸より少し広い程度にし、押せる丸より小さくする", () => {
      for (const name of [from, to]) {
        const place = scene.placeOf(name);
        expect(place.markRadius).toBeLessThanOrEqual(14);
        expect(place.markRadius).toBeLessThanOrEqual(place.hitRadius);
      }
    });

    it("線の中ほどを押すと、その路線の駅の間を一番近い候補にする", () => {
      const target = scene.tap(middle);
      if (target.kind !== "rail") throw new Error(`駅の間になりません: ${target.kind}`);
      expect(target.lineIds[0]).toBe(lineId);
      expect(target.lineIds.length).toBeLessThanOrEqual(3);
      const [first] = scene.listChoicesAt(middle, target.lineIds);
      if (first?.kind !== "between") throw new Error("駅の間の候補がありません");
      expect(first.line.lineId).toBe(lineId);
      expect(first.line.name.ja).toBe(label);
      expect([first.from.name, first.to.name].sort()).toEqual([from, to].sort());
    });
  });

  describe("札の上を押したとき", () => {
    const middle = findTrackMidpoint(loop, "大阪", "福島");
    const scene = buildScene(middle, 13.5);
    const nishiUmeda = scene.placeOf("西梅田");

    it("札の下に描いた線があれば、駅の間にする", () => {
      expect(scene.tap(middle, nishiUmeda)).toMatchObject({ kind: "rail" });
    });

    it("札の下に線が無ければ、札の駅を選ぶ", () => {
      const point = scene.project(middle);
      const away = selectMapTapTarget({
        point: { x: point.x, y: point.y - LABEL_RAIL_TAP_PX * 4 },
        stations: [],
        rails: [{ lineId: loop, paths: [[point, { x: point.x + 40, y: point.y }]] }],
        labelKey: nishiUmeda.place.key,
      });
      expect(away).toEqual({ kind: "station", key: nishiUmeda.place.key });
    });
  });

  it("線から離れた所は、押せる丸の内の駅を選び、その外は何もしない", () => {
    const station = { key: "a", point: { x: 100, y: 100 }, markRadius: 12, hitRadius: 22 };
    const rails: ScreenRail[] = [
      {
        lineId: "x",
        paths: [
          [
            { x: 0, y: 100 },
            { x: 200, y: 100 },
          ],
        ],
      },
    ];
    const tap = (x: number, y: number) =>
      selectMapTapTarget({ point: { x, y }, stations: [station], rails, labelKey: null });
    // 中心の近くは線の上でも駅
    expect(tap(108, 100)).toEqual({ kind: "station", key: "a" });
    // 印の外で線の上なら駅の間
    expect(tap(118, 100)).toEqual({ kind: "rail", lineIds: ["x"] });
    // 線から離れていれば、押せる丸の内の駅
    expect(
      selectMapTapTarget({
        point: { x: 100, y: 80 },
        stations: [station],
        rails: [],
        labelKey: null,
      }),
    ).toEqual({ kind: "station", key: "a" });
    expect(
      selectMapTapTarget({
        point: { x: 100, y: 60 },
        stations: [station],
        rails: [],
        labelKey: null,
      }),
    ).toEqual({ kind: "none" });
  });
});
