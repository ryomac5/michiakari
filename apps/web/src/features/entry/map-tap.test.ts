import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { projectToWorld, type ScreenPoint } from "@/features/map/bubble-layout";
import { createMapGeo, type LinesGeoJson } from "@/features/map/geo-data";
import { createEntryData, findStationChoice, type Position } from "./entry-places";
import { listGpsChoices, listLineTapChoices } from "./gps-candidates";
import {
  buildSegmentPath,
  computePathMidpoint,
  LABEL_RAIL_TAP_PX,
  type ScreenRail,
  selectMapTapTarget,
  selectRailTapOutcome,
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
      geo.trackShapes,
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

describe("listLineTapChoices の駅の間", () => {
  const describeChoice = (c: ReturnType<typeof listLineTapChoices>[number]) =>
    c.kind === "between" ? `${c.line.lineId}:${[c.from.name, c.to.name].sort().join("-")}` : "";

  it("大阪〜福島の環状線を押すと、大阪と福島の組は環状線の駅の間だけにする", () => {
    const middle = findTrackMidpoint(loop, "大阪", "福島");
    const scene = buildScene(middle, 13.5);
    const target = scene.tap(middle);
    if (target.kind !== "rail") throw new Error("駅の間になりません");
    const choices = scene.listChoicesAt(middle, target.lineIds).map(describeChoice);
    // 環状線を先頭に出す。東海道線の大阪〜福島の 2 駅だけの区間は旅客の駅の間ではないので出さない
    expect(choices[0]).toBe(`${loop}:大阪-福島`);
    expect(choices.filter((c) => c.endsWith(":大阪-福島"))).toEqual([`${loop}:大阪-福島`]);
    // 大阪を出た JR神戸線は、福島の手前まで環状線に沿って描かれている。出すなら、実在する大阪〜塚本にする
    expect(choices.filter((c) => c.startsWith(`${kobe}:`))).toEqual(
      choices.some((c) => c.startsWith(`${kobe}:`)) ? [`${kobe}:塚本-大阪`] : [],
    );
  });

  it("現在地から読み取るときも、大阪と福島の組は環状線の駅の間だけにする", () => {
    const [lon, lat] = findTrackMidpoint(loop, "大阪", "福島");
    const pairs = listGpsChoices(data, geo.nodes, { lon, lat, accuracy: 20 })
      .map(describeChoice)
      .filter((c) => c.endsWith(":大阪-福島"));
    expect(pairs).toEqual([`${loop}:大阪-福島`]);
  });

  it("どちらの駅の間も実在する路線が並ぶ所では、両方を出す", () => {
    // 阪神本線の福島〜大阪梅田は、環状線の福島〜大阪の南に沿って描かれている。両方の線の間を押す
    const loopMiddle = findTrackMidpoint(loop, "大阪", "福島");
    const hanshin = "hanshin.本線";
    const scene = buildScene(loopMiddle, 12.5);
    const choices = scene.listChoicesAt(loopMiddle, [loop, hanshin]).map(describeChoice);
    expect(choices).toEqual([`${loop}:大阪-福島`, `${hanshin}:大阪梅田-福島`]);
  });
});

describe("押した線に環状線が入らないとき", () => {
  const [lon, lat] = findTrackMidpoint(loop, "大阪", "福島");

  it("東海道線だけを渡しても、2 駅だけの大阪〜福島は出さない", () => {
    // 線路の形で絞る前の、駅を結ぶ直線の 800m の幅でも出さない
    for (const shapes of [undefined, geo.trackShapes]) {
      const choices = listLineTapChoices(data, geo.nodes, { lon, lat }, 250, [kobe], shapes);
      const pairs = choices.map((c) =>
        c.kind === "between" ? [c.from.name, c.to.name].sort().join("-") : "",
      );
      expect(pairs).not.toContain("大阪-福島");
    }
  });
});

describe("駅を受け付けない段", () => {
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
  const tap = (x: number, y: number, withRails: boolean, labelKey: string | null = null) =>
    selectMapTapTarget({
      point: { x, y },
      stations: [station],
      rails: withRails ? rails : [],
      labelKey,
      placePickable: false,
    });

  it("駅の近くの線を押すと、駅ではなく線として扱う", () => {
    // 駅の段の路線の線は rails に入らないので none になり、路線を選ぶ判定へ回る
    expect(tap(118, 100, false)).toEqual({ kind: "none" });
    expect(tap(100, 100, false)).toEqual({ kind: "none" });
    // 駅の間の段は、駅の印の上でも線の上なら駅の間にする
    expect(tap(118, 100, true)).toEqual({ kind: "rail", lineIds: ["x"] });
    expect(tap(104, 100, true)).toEqual({ kind: "rail", lineIds: ["x"] });
  });

  it("札を押しても札の駅は選ばず、線から 22px の内なら駅の間にする", () => {
    expect(tap(130, 115, true, "a")).toEqual({ kind: "rail", lineIds: ["x"] });
    expect(tap(130, 140, true, "a")).toEqual({ kind: "none" });
  });
});

describe("selectRailTapOutcome", () => {
  it("駅の間の候補があれば尋ね、無ければ札の駅を選び、札でもなければ何も無い所として扱う", () => {
    expect(selectRailTapOutcome(2, "osaka")).toEqual({ kind: "ask" });
    expect(selectRailTapOutcome(0, "osaka")).toEqual({ kind: "station", place: "osaka" });
    expect(selectRailTapOutcome(0, null)).toEqual({ kind: "tap" });
  });
});
