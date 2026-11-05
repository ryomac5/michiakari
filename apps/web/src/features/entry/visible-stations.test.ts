import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { overlapArea, projectToWorld, type Rect } from "@/features/map/bubble-layout";
import { createMapGeo } from "@/features/map/geo-data";
import { createEntryData } from "./entry-places";
import {
  buildStationDotRect,
  buildStationLabelRect,
  computeOverviewThreshold,
  listMapStations,
  type MapStation,
  STATION_LABEL_MIN_ZOOM,
  selectVisibleStations,
  type VisibleStation,
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
function select(choices: MapStation[], zoom = 15, blockers: Rect[] = []) {
  return selectVisibleStations({ stations: choices, zoom, view, project, locale: "ja", blockers });
}
const keysOf = (stations: VisibleStation[]) => stations.map((s) => s.place.key);

describe("selectVisibleStations の引いた地図", () => {
  const overviewZoom = STATION_LABEL_MIN_ZOOM - 1.4;
  it("乗降客数の多い駅だけを名前付きで出す", () => {
    const threshold = computeOverviewThreshold(overviewZoom);
    const choices = [
      buildStation("major", 100, 100, threshold),
      buildStation("minor", 300, 100, threshold - 1),
    ];
    const picked = select(choices, overviewZoom);
    expect(keysOf(picked)).toEqual(["major"]);
    expect(picked[0]?.label).toEqual({ side: "right", size: "small", slide: 0, tappable: true });
  });
  it("寄るほど名前を出す駅の下限を下げる", () => {
    expect(computeOverviewThreshold(11)).toBeGreaterThan(computeOverviewThreshold(12));
    expect(computeOverviewThreshold(12.99)).toBeGreaterThan(0);
  });
  it("関西の段の丸がまとめる駅は出さない", () => {
    expect(select([buildStation("osaka", 100, 100, 2000000)], overviewZoom)).toEqual([]);
  });
  it("丸の札とぶつかる駅は出さず、名前の置けない駅も出さない", () => {
    const hub: Rect = { left: 80, right: 200, top: 80, bottom: 120 };
    expect(select([buildStation("A", 100, 100, 2000000)], overviewZoom, [hub])).toEqual([]);
    const around: Rect[] = [
      { left: 300, right: 600, top: 0, bottom: 192 },
      { left: 0, right: 294, top: 0, bottom: 400 },
      { left: 300, right: 600, top: 208, bottom: 400 },
    ];
    expect(select([buildStation("B", 300, 200, 2000000)], overviewZoom, around)).toEqual([]);
  });
});

describe("selectVisibleStations の寄せた地図", () => {
  it("見えている駅の印を全部出し、範囲外や縁で欠ける駅を除く", () => {
    const choices = [
      buildStation("A", 100, 100, 100000),
      buildStation("B", 300, 300, 0),
      buildStation("out", 700, 100, 200000),
      buildStation("edge", 100, -1, 200000),
      buildStation("rim", 2, 200, 200000),
    ];
    expect(keysOf(select(choices, STATION_LABEL_MIN_ZOOM))).toEqual(["A", "B"]);
  });
  it("乗降客数の多い駅は大きな札、少ない駅は小さな文字にする", () => {
    const picked = select([
      buildStation("major", 100, 100, 100000),
      buildStation("minor", 300, 300, 99),
    ]);
    expect(picked.map((s) => [s.place.key, s.major, s.label?.size])).toEqual([
      ["major", true, "large"],
      ["minor", false, "small"],
    ]);
  });
  it("札が重なる駅も印は消さず、名前を小さくするか向きを変える", () => {
    const choices = [
      buildStation("big", 100, 100, 500000),
      buildStation("next", 100, 130, 200000),
      buildStation("near", 130, 100, 100),
    ];
    const picked = select(choices);
    expect(keysOf(picked)).toEqual(["big", "next", "near"]);
    expect(picked.every((s) => s.label !== null)).toBe(true);
    expect(new Set(picked.map((s) => `${s.label?.side}`)).size).toBeGreaterThan(1);
    expect(select(choices.toReversed())).toEqual(picked);
  });
  it("どこにも置けない名前だけを隠し、印は残す", () => {
    const crowd = Array.from({ length: 9 }, (_, i) =>
      buildStation(`s${i}`, 300 + (i % 3) * 12, 200 + Math.floor(i / 3) * 12, 1000 - i),
    );
    const picked = select(crowd);
    expect(picked).toHaveLength(9);
    expect(picked.some((s) => s.label === null)).toBe(true);
    expect(picked[0]?.label).not.toBeNull();
  });
  it("置いた名前の札どうしと、札とほかの駅の印は重ならない", () => {
    const crowd = Array.from({ length: 16 }, (_, i) =>
      buildStation(`s${i}`, 200 + (i % 4) * 40, 150 + Math.floor(i / 4) * 30, 200000 - i * 10000),
    );
    const picked = select(crowd);
    const labels = picked.flatMap((s) =>
      s.label
        ? [
            {
              key: s.place.key,
              box: buildStationLabelRect({
                point: project(s.place.position),
                label: s.place.name.ja,
                colors: 0,
                ...s.label,
              }),
            },
          ]
        : [],
    );
    expect(labels.length).toBeGreaterThan(8);
    for (const [i, a] of labels.entries())
      for (const b of labels.slice(i + 1)) expect(overlapArea(a.box, b.box)).toBe(0);
    for (const label of labels) {
      for (const other of picked.filter((s) => s.place.key !== label.key)) {
        const dot = buildStationDotRect(project(other.place.position), other.major);
        expect(overlapArea(label.box, dot), `${label.key} と ${other.place.key} の印`).toBe(0);
      }
    }
  });
  it("押せる丸は隣の駅の印に届かず、離れた駅は既定の大きさにする", () => {
    const choices = [
      buildStation("big", 100, 100, 500000),
      buildStation("close", 118, 100, 50),
      buildStation("far", 400, 300, 50),
    ];
    const picked = select(choices);
    const byKey = new Map(picked.map((s) => [s.place.key, s]));
    for (const a of picked) {
      for (const b of picked.filter((s) => s !== a)) {
        const [ax, ay] = a.place.position;
        const [bx, by] = b.place.position;
        const dot = buildStationDotRect({ x: bx, y: by }, b.major);
        const reach = Math.hypot(ax - bx, ay - by) - (dot.right - dot.left) / 2;
        expect(a.hitRadius, `${a.place.key} が ${b.place.key} の印に届く`).toBeLessThanOrEqual(
          reach,
        );
      }
    }
    expect(byKey.get("big")?.hitRadius).toBeLessThan(24);
    expect(byKey.get("far")?.hitRadius).toBe(22);
  });
  it("ほかの駅の押せる丸に掛かる札は押せなくする", () => {
    // big の札は右に置け、右下の small の印は避けるが、small の押せる丸には掛かる
    const picked = select([
      buildStation("big", 100, 100, 500000),
      buildStation("small", 150, 128, 50),
      buildStation("lone", 400, 300, 50),
    ]);
    const byKey = new Map(picked.map((s) => [s.place.key, s]));
    expect(byKey.get("big")?.label).toMatchObject({ side: "right", tappable: false });
    expect(byKey.get("lone")?.label?.tappable).toBe(true);
  });
  it("関西の段の丸の押せる範囲に入る駅は、引いた地図に出さない", () => {
    const zoom = STATION_LABEL_MIN_ZOOM - 1;
    const station = buildStation("A", 100, 100, 2000000);
    const near = { point: { x: 120, y: 100 }, dotRadius: 13, hitRadius: 24 };
    const far = { point: { x: 300, y: 300 }, dotRadius: 13, hitRadius: 24 };
    const run = (targets: (typeof near)[]) =>
      selectVisibleStations({ stations: [station], zoom, view, project, locale: "ja", targets });
    expect(run([near])).toEqual([]);
    expect(keysOf(run([far]))).toEqual(["A"]);
  });
  it("開いたエリアの駅は、乗降客数が少なくても先に名前を置く", () => {
    const choices = [buildStation("busy", 100, 100, 500000), buildStation("area", 100, 100, 10)];
    const picked = selectVisibleStations({
      stations: choices,
      zoom: 15,
      view,
      project,
      locale: "ja",
      priorityKeys: ["area"],
    });
    expect(keysOf(picked)).toEqual(["area", "busy"]);
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
    expect(place?.label?.side).toBe("left");
  });
  it("駅を選んだあとは乗降客数より選択駅を優先して大きな札にする", () => {
    const choices = [buildStation("A", 100, 100, 100000), buildStation("B", 100, 100, 0)];
    const picked = selectVisibleStations({
      stations: choices,
      zoom: 13,
      view,
      project,
      locale: "ja",
      selectedKey: "B",
    });
    expect(picked[0]?.place.key).toBe("B");
    expect(picked[0]?.label?.size).toBe("large");
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
      selectAround([135.758, 34.985]).some(({ place: p }) =>
        p.lines.some((l) => l.lineId === "kintetsu.京都線"),
      ),
    ).toBe(true);
    expect(
      selectAround([135.194, 34.694]).some(({ place: p }) =>
        p.lines.some((l) => l.lineId === "hanshin.本線"),
      ),
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
  {
    center: [135.4985, 34.702] as [number, number],
    zoom: 13.1,
    keys: ["osaka", "umeda", "osaka-umeda", "kitashinchi", "福島", "天満", "中津"],
  },
])("狭い画面でエリアの主な駅と隣の駅を名前付きで選べる: $keys", ({ center, zoom, keys }) => {
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
  expect(places.map(({ place }) => place.key)).toEqual(expect.arrayContaining(keys));
  const unnamed = places.filter((s) => keys.includes(s.place.key) && s.label === null);
  expect(unnamed.map((s) => s.place.key)).toEqual([]);
});
