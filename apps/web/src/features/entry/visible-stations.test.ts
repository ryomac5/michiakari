import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { projectToWorld } from "@/features/map/bubble-layout";
import { createMapGeo } from "@/features/map/geo-data";
import { createEntryData } from "./entry-places";
import {
  listMapStations,
  type MapStation,
  STATION_LABEL_MIN_ZOOM,
  selectVisibleStations,
} from "./visible-stations";

const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);
const stations = listMapStations(data);
const view = { left: 0, right: 600, top: 0, bottom: 400 };
const project = ([x, y]: [number, number]) => ({ x, y });
function buildStation(key: string, x: number, y: number, passengers: number): MapStation {
  return {
    passengers,
    place: {
      key,
      name: { ja: key, en: key },
      position: [x, y],
      side: { wide: "right", narrow: "right" },
      lines: [],
    },
  };
}
function select(choices: MapStation[], zoom = 15) {
  return selectVisibleStations({ stations: choices, zoom, view, project, locale: "ja" });
}

describe("selectVisibleStations", () => {
  it("引いた地図では駅の札を出さない", () => {
    expect(select([buildStation("A", 100, 100, 100000)], STATION_LABEL_MIN_ZOOM - 0.01)).toEqual(
      [],
    );
  });
  it("境界の倍率から主要駅を出し、範囲外や縁で欠ける駅を除く", () => {
    const choices = [
      buildStation("A", 100, 100, 100000),
      buildStation("B", 700, 100, 200000),
      buildStation("C", 100, -1, 200000),
      buildStation("D", 2, 200, 200000),
    ];
    expect(select(choices, STATION_LABEL_MIN_ZOOM).map((p) => p.key)).toEqual(["A"]);
  });
  it("乗降客数の多い駅を先に出し、重なる札と印を増やさない", () => {
    const choices = [
      buildStation("small", 100, 100, 100),
      buildStation("major", 100, 100, 100000),
      buildStation("far", 400, 300, 10000),
    ];
    expect(select(choices).map((p) => p.key)).toEqual(["major", "far"]);
    expect(select(choices.toReversed())).toEqual(select(choices));
  });
  it("拡大するほど小さい駅と乗降客数の無い駅を足す", () => {
    const choices = [
      buildStation("A", 100, 100, 100000),
      buildStation("B", 300, 100, 3000),
      buildStation("C", 500, 300, 0),
    ];
    expect(select(choices, 13).map((p) => p.key)).toEqual(["A"]);
    expect(select(choices, 14.5).map((p) => p.key)).toEqual(["A", "B"]);
    expect(select(choices, 15).map((p) => p.key)).toEqual(["A", "B", "C"]);
  });
  it("長い英語名も画面の内側に収まる向きに置く", () => {
    const station = buildStation("Nishinakajima-Minamigata", 500, 200, 100000);
    const [place] = selectVisibleStations({
      stations: [station],
      zoom: 15,
      view,
      project,
      locale: "en",
    });
    expect(place?.side.wide).toBe("left");
  });
  it("駅を選んだあとは乗降客数より選択駅を優先する", () => {
    const choices = [buildStation("A", 100, 100, 100000), buildStation("B", 100, 100, 0)];
    expect(
      selectVisibleStations({
        stations: choices,
        zoom: 13,
        view,
        project,
        locale: "ja",
        selectedKey: "B",
      }).map((p) => p.key),
    ).toEqual(["B"]);
  });
  it("駅の無い範囲は空になる", () => {
    expect(select([])).toEqual([]);
  });
});

describe("全駅の候補", () => {
  it("京都の同名駅を取り違えず、私鉄の路線と英語名を持つ", () => {
    const toji = stations.find((s) => s.place.key === "toji");
    expect(toji?.place.name.en).toBe("Toji");
    expect(toji?.place.lines.some((l) => l.lineId === "kintetsu.京都線")).toBe(true);
    for (const key of ["kujo", "gojo"]) {
      const station = stations.find((s) => s.place.key === key);
      expect(station?.place.position[1]).toBeGreaterThan(34.97);
      expect(station?.place.lines.map((l) => l.lineId)).toEqual(["kyoto-subway.烏丸線"]);
    }
  });
  it("手書き一覧にない駅も候補に入れ、三宮の路線を失わない", () => {
    expect(stations.some((s) => s.place.name.ja === "京都河原町")).toBe(true);
    expect(stations.some((s) => s.place.name.ja === "西宮北口")).toBe(true);
    expect(
      stations.find((s) => s.place.key === "sannomiya")?.place.lines.map((l) => l.lineId),
    ).toContain("hanshin.本線");
    expect(new Set(stations.map((s) => s.place.key)).size).toBe(stations.length);
  });
  it("移動後の範囲から駅を選び直す", () => {
    const zoom = 15;
    const selectAround = (center: [number, number]) => {
      const origin = projectToWorld(center, zoom);
      return selectVisibleStations({
        stations,
        zoom,
        view,
        locale: "en",
        project: (p) => {
          const point = projectToWorld(p, zoom);
          return { x: point.x - origin.x + 300, y: point.y - origin.y + 200 };
        },
      });
    };
    expect(
      selectAround([135.758, 34.985]).some((p) =>
        p.lines.some((l) => l.lineId === "kintetsu.京都線"),
      ),
    ).toBe(true);
    expect(
      selectAround([135.194, 34.694]).some((p) => p.lines.some((l) => l.lineId === "hanshin.本線")),
    ).toBe(true);
  });
});

it.each([
  {
    center: [135.4967, 34.7022] as [number, number],
    zoom: 14.9,
    keys: ["osaka", "umeda", "osaka-umeda"],
  },
  { center: [135.7601, 34.9872] as [number, number], zoom: 13.5, keys: ["kyoto", "toji"] },
  { center: [135.1895, 34.6915] as [number, number], zoom: 14, keys: ["sannomiya"] },
])("狭い画面でエリアの主な駅を選べる: $keys", ({ center, zoom, keys }) => {
  const origin = projectToWorld(center, zoom);
  const places = selectVisibleStations({
    stations,
    zoom,
    locale: "ja",
    view: { left: 8, right: 382, top: 88, bottom: 500 },
    project: (position) => {
      const point = projectToWorld(position, zoom);
      return { x: point.x - origin.x + 195, y: point.y - origin.y + 294 };
    },
  });
  expect(places.map((place) => place.key)).toEqual(expect.arrayContaining(keys));
});
