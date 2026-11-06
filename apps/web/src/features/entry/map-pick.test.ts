import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import {
  type DirectionStop,
  type EntryDirection,
  isLoopAt,
  listEntryDirections,
} from "./directions";
import {
  createEntryData,
  type EntryLine,
  type Position,
  resolveConfiguredArea,
} from "./entry-places";
import { listTrainLines } from "./infer-route";
import {
  BETWEEN_PICK_MIN_ZOOM,
  buildSegmentPath,
  computeMidpoint,
  computePathMidpoint,
  computeSegmentApproachRadii,
  computeSegmentApproachZoom,
  computeSegmentHitRadii,
  findNearestLineId,
  findNearestSegment,
  isOnRoute,
  listLinePicks,
  listLineStops,
  listRouteStops,
  listSegmentWindow,
  measurePathDistance,
  measureSegmentDistance,
  mergeRouteCandidates,
  pickLineAt,
  pickLineTap,
  placeDirectionTag,
  selectAwaySide,
  selectRailTapAction,
} from "./map-pick";
import { STATION_LABEL_MIN_ZOOM } from "./visible-stations";

// 実データで、大阪駅から地図で路線・方面・行き先を選べるか確かめる
const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);
const osaka = resolveConfiguredArea(data, "umeda")?.places.find((p) => p.key === "osaka");
const directionsOf = (line: EntryLine) => listEntryDirections(data, line);

function findOsakaLine(observedName: string): EntryLine {
  const line = osaka?.lines.find((l) => l.observedName === observedName);
  if (!line) throw new Error(`大阪の ${observedName} がありません`);
  return line;
}

function buildStop(id: string, position: Position): DirectionStop {
  return {
    choice: {
      id,
      name: id,
      nameEn: null,
      lat: position[1],
      lon: position[0],
      operators: [],
    } as unknown as DirectionStop["choice"],
    position,
    passengers: 0,
    sameOperator: true,
  };
}

describe("listLinePicks", () => {
  it("大阪では環状線・神戸線・京都線の札を、それぞれ別の向きの線の上に置く", () => {
    if (!osaka) throw new Error("大阪がありません");
    const picks = listLinePicks(osaka.lines, osaka.position, directionsOf);
    expect(picks.map((p) => p.line.observedName).sort()).toEqual(
      ["JR京都線", "JR環状線", "JR神戸線"].sort(),
    );
    const keys = new Set(picks.map((p) => p.position.join(",")));
    expect(keys.size).toBe(picks.length);
    // 札は駅と隣の駅の間に置く
    for (const pick of picks) {
      const meters = measureSegmentDistance(pick.position, osaka.position, osaka.position);
      expect(meters).toBeGreaterThan(300);
      expect(meters).toBeLessThan(3000);
    }
  });

  it("同じ線を通る通称は、最初の方面の側に置き、重なれば別の方面へ回す", () => {
    const origin: Position = [135, 34];
    const next = buildStop("b", [135.02, 34]);
    const back = buildStop("c", [134.98, 34]);
    const direction = (stops: DirectionStop[]) =>
      ({ key: stops[0]?.choice.id, stops }) as unknown as ReturnType<typeof directionsOf>[number];
    const a = findOsakaLine("JR神戸線");
    const b = findOsakaLine("JR京都線");
    const picks = listLinePicks([a, b], origin, () => [direction([next]), direction([back])]);
    // 札は隣の駅の手前、4 分の 3 の所に置く
    expect(picks[0]?.position[0]).toBeCloseTo(135.015);
    expect(picks[1]?.position[0]).toBeCloseTo(134.985);
  });
});

describe("pickLineAt", () => {
  it("東海道線を押したら、押した点に近い通称の路線を選ぶ", () => {
    const options = listTrainLines(data)
      .filter((l) => l.lineId === "jr-west.東海道線")
      .map((line) => ({
        line,
        path: (directionsOf(line)[0]?.stops ?? []).map((s) => s.position),
      }));
    // 尼崎のあたりは神戸線、高槻のあたりは京都線
    expect(pickLineAt(options, [135.4318, 34.7318])?.observedName).toBe("JR神戸線");
    expect(pickLineAt(options, [135.6178, 34.8516])?.observedName).toBe("JR京都線");
    expect(pickLineAt([], [135, 34])).toBeNull();
  });
});

describe("findNearestLineId", () => {
  it("押した点にいちばん近い線の路線を返す", () => {
    const features = [
      { lineId: "far", paths: [[[135, 34.01] as Position, [135.01, 34.01] as Position]] },
      { lineId: "near", paths: [[[135, 34.001] as Position, [135.01, 34.001] as Position]] },
    ];
    expect(findNearestLineId(features, [135.005, 34])).toBe("near");
    expect(findNearestLineId([], [135, 34])).toBeNull();
  });
});

describe("listRouteStops", () => {
  it("大阪の環状線で新今宮・天王寺の方面を選ぶと、福島から近い順に出す", () => {
    const loop = findOsakaLine("JR環状線");
    const west = directionsOf(loop).find((d) => d.label.ja.includes("天王寺"));
    if (!west) throw new Error("天王寺の方面がありません");
    const stops = listRouteStops(west);
    expect(stops[0]?.choice.name).toBe("福島");
    expect(stops.length).toBeLessThanOrEqual(6);
    expect(isOnRoute(west, "福島")).toBe(true);
    expect(isOnRoute(west, "天満")).toBe(false);
    expect(isOnRoute(null, "福島")).toBe(false);
  });

  it("地図に出した駅を先に並べ、重複を除いて候補を続ける", () => {
    const a = buildStop("a", [135, 34]);
    const b = buildStop("b", [135.01, 34]);
    const c = buildStop("c", [135.02, 34]);
    expect(mergeRouteCandidates([a, b], [c, a]).map((s) => s.choice.id)).toEqual(["a", "b", "c"]);
  });
});

describe("listSegmentWindow", () => {
  const stops = Array.from({ length: 12 }, (_, i) => buildStop(`s${i}`, [135 + i * 0.01, 34]));

  it("選んでいる駅の間の前後 3 つずつを出し、端では反対側へ寄せる", () => {
    expect(listSegmentWindow(stops, 5).map((s) => s.index)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(listSegmentWindow(stops, 0).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(listSegmentWindow(stops, 10).map((s) => s.index)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(listSegmentWindow(stops.slice(0, 1), 0)).toEqual([]);
  });

  it("押した点に一番近い駅の間を選ぶ", () => {
    const segments = listSegmentWindow(stops, 5);
    expect(findNearestSegment(segments, [135.045, 34.001])?.index).toBe(4);
    expect(findNearestSegment([], [135, 34])).toBeNull();
  });
});

describe("computeSegmentHitRadii の駅の印", () => {
  it("ほかの印に届かない半径にし、小さすぎれば出さない", () => {
    const origin = [{ x: 0, y: 0 }];
    expect(computeSegmentHitRadii(origin, [])).toEqual([22]);
    expect(computeSegmentHitRadii(origin, [{ point: { x: 40, y: 0 }, radius: 24 }])).toEqual([16]);
    expect(computeSegmentHitRadii(origin, [{ point: { x: 30, y: 0 }, radius: 24 }])).toEqual([
      null,
    ]);
  });
});

describe("selectAwaySide", () => {
  it("札の多い向きと反対の側を返し、札が無ければ null にする", () => {
    const origin: Position = [135, 34];
    expect(
      selectAwaySide(origin, [
        [134.99, 34.001],
        [134.98, 33.999],
      ]),
    ).toBe("right");
    expect(selectAwaySide(origin, [[135.001, 34.01]])).toBe("bottom");
    expect(selectAwaySide(origin, [[135, 33.99]])).toBe("top");
    expect(selectAwaySide(origin, [])).toBeNull();
  });
});

describe("computeSegmentHitRadii", () => {
  it("隣り合う駅の間の押せる丸を、互いの中点の内側に収める", () => {
    const radii = computeSegmentHitRadii(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 200, y: 0 },
      ],
      [],
    );
    expect((radii[0] ?? 0) + (radii[1] ?? 0)).toBeLessThanOrEqual(30);
    expect(radii[2]).toBe(22);
  });

  it("駅の印の押せる丸にも届かない大きさにし、取れなければ null にする", () => {
    const radii = computeSegmentHitRadii(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { point: { x: 40, y: 0 }, radius: 24 },
        { point: { x: 115, y: 0 }, radius: 10 },
      ],
    );
    expect(radii).toEqual([16, null]);
  });
});

describe("findNearestSegment の距離の制限", () => {
  it("押した点が候補の駅の間から押せる範囲の外なら決めない", () => {
    const stops = Array.from({ length: 4 }, (_, i) => buildStop(`t${i}`, [135 + i * 0.01, 34]));
    const segments = listSegmentWindow(stops, 1);
    // 線から 50m ほどなら選び、2km ほど離れていれば選ばない
    expect(findNearestSegment(segments, [135.015, 34.0005], 100)?.index).toBe(1);
    expect(findNearestSegment(segments, [135.015, 34.02], 100)).toBeNull();
  });
});

function buildDirection(key: string, stops: DirectionStop[]): EntryDirection {
  const last = stops.at(-1) as DirectionStop;
  return {
    key,
    label: { ja: key, en: key },
    landmarks: [],
    stops,
    fallback: { stop: last, kind: "terminal" },
  };
}

describe("pickLineTap", () => {
  // 東西にまっすぐ延びる端のある路線。駅は約 900m おき
  const origin: Position = [135, 34];
  const east = buildDirection(
    "east",
    [1, 2, 3].map((i) => buildStop(`e${i}`, [135 + i * 0.01, 34])),
  );
  const west = buildDirection(
    "west",
    [1, 2, 3].map((i) => buildStop(`w${i}`, [135 - i * 0.01, 34])),
  );
  const straight = {
    origin,
    directions: [east, west],
    stops: [...east.stops, ...west.stops],
    loop: false,
    reachMeters: 200,
    onLine: true,
  };

  it("端のある路線では、押した点のある側の方面を選ぶ", () => {
    expect(pickLineTap({ ...straight, point: [135.015, 34.0005] })).toMatchObject({
      direction: { key: "east" },
      stop: null,
    });
    expect(pickLineTap({ ...straight, point: [134.975, 33.9995] })).toMatchObject({
      direction: { key: "west" },
      stop: null,
    });
  });

  it("駅の近くを押すと、その駅を行き先にし、その駅へ向かう方面を選ぶ", () => {
    const tap = pickLineTap({ ...straight, point: [134.9801, 34.0008] });
    expect(tap?.direction.key).toBe("west");
    expect(tap?.stop?.choice.id).toBe("w2");
  });

  it("描いた線を押していなければ、駅を結ぶ直線の上でも決めない。出発の駅の近くも決めない", () => {
    expect(pickLineTap({ ...straight, point: [135.015, 34], onLine: false })).toBeNull();
    expect(pickLineTap({ ...straight, point: [135.0005, 34.0005] })).toBeNull();
  });

  it("描いた線が駅を結ぶ直線から 650m ほど離れていても、線を押せば方面を選ぶ", () => {
    // 直線から北へ約 670m。塚本〜尼崎のように描いた線が曲がっている所
    expect(pickLineTap({ ...straight, point: [135.015, 34.006] })).toMatchObject({
      direction: { key: "east" },
      stop: null,
    });
  });

  it("近くの駅を行き先にするのは、地図に印を出している駅だけにする", () => {
    // w3 は印を出していない。近くを押しても行き先にしない
    const marked = { ...straight, stops: [...east.stops, ...west.stops.slice(0, 2)] };
    const nearW3: Position = [134.9701, 34.0005];
    expect(pickLineTap({ ...marked, point: nearW3, onLine: false })).toBeNull();
    expect(pickLineTap({ ...marked, point: nearW3 })).toMatchObject({
      direction: { key: "west" },
      stop: null,
    });
  });

  // 8 駅の環状線。出発の駅から左回りと右回りに 4 駅ずつで、反対側の駅は両方に入る
  const ring = Array.from({ length: 8 }, (_, i): Position => {
    const angle = (i / 8) * Math.PI * 2;
    return [135 + Math.cos(angle) * 0.02, 34 + Math.sin(angle) * 0.02];
  });
  const ringStop = (i: number) => buildStop(`r${i}`, ring[i] as Position);
  const left = buildDirection("left", [1, 2, 3, 4].map(ringStop));
  const right = buildDirection("right", [7, 6, 5, 4].map(ringStop));
  const loop = {
    origin: ring[0] as Position,
    directions: [left, right],
    stops: listLineStops([left, right]),
    loop: true,
    reachMeters: 200,
    onLine: true,
  };
  const between = (a: number, b: number, t = 0.5): Position => {
    const p = ring[a] as Position;
    const q = ring[b] as Position;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };

  it("環状線では、出発の駅から押した点まで駅の数の少ない回り方を選ぶ", () => {
    expect(pickLineTap({ ...loop, point: between(1, 2) })?.direction.key).toBe("left");
    expect(pickLineTap({ ...loop, point: between(6, 5) })?.direction.key).toBe("right");
    // 反対側の駅の手前は、少ない側の回り方にする
    expect(pickLineTap({ ...loop, point: between(4, 5, 0.3) })?.direction.key).toBe("right");
    expect(pickLineTap({ ...loop, point: between(3, 4, 0.7) })?.direction.key).toBe("left");
  });

  it("環状線で同じ駅の数なら、先に並ぶ方面にする", () => {
    const tap = pickLineTap({ ...loop, point: ring[4] as Position });
    expect(tap).toMatchObject({ direction: { key: "left" }, stop: { choice: { id: "r4" } } });
    const swapped = pickLineTap({ ...loop, directions: [right, left], point: ring[4] as Position });
    expect(swapped?.direction.key).toBe("right");
  });

  it("大阪で環状線を選び、天満のあたりを押すと、行き先は天満で、天満を通る方面になる", () => {
    if (!osaka) throw new Error("大阪がありません");
    const line = findOsakaLine("JR環状線");
    const directions = directionsOf(line);
    const temma = directions.flatMap((d) => d.stops).find((s) => s.choice.name === "天満");
    if (!temma) throw new Error("天満がありません");
    expect(isLoopAt(data, line)).toBe(true);
    const tap = pickLineTap({
      origin: osaka.position,
      directions,
      stops: listLineStops(directions),
      loop: true,
      point: [temma.position[0] + 0.001, temma.position[1] + 0.0005],
      reachMeters: 300,
      onLine: false,
    });
    expect(tap?.stop?.choice.name).toBe("天満");
    expect(tap?.direction.stops[0]?.choice.name).toBe("天満");
  });
});

describe("listLineStops", () => {
  it("大阪で環状線を選ぶと、両方向の駅を 6 駅ずつ出す", () => {
    const directions = directionsOf(findOsakaLine("JR環状線"));
    const names = listLineStops(directions).map((s) => s.choice.name);
    expect(names).toHaveLength(12);
    expect(names).toEqual(expect.arrayContaining(["天満", "京橋", "福島", "西九条"]));
    expect(names).not.toContain("大阪");
  });

  it("両方向に同じ駅があれば 1 つにまとめる", () => {
    const a = buildStop("a", [135.01, 34]);
    const b = buildStop("b", [134.99, 34]);
    const directions = [buildDirection("x", [a, b]), buildDirection("y", [b, a])];
    expect(listLineStops(directions).map((s) => s.choice.id)).toEqual(["a", "b"]);
  });

  it("方面の札は、地図に出した駅の先に置き、駅の印と重ねない", () => {
    const direction = buildDirection(
      "east",
      [1, 2, 3].map((i) => buildStop(`e${i}`, [135 + i * 0.01, 34])),
    );
    const tag = placeDirectionTag([135, 34], direction, 2);
    expect(tag?.[0]).toBeCloseTo(135.025);
    expect(tag?.[1]).toBeCloseTo(34);
  });
});

describe("selectRailTapAction", () => {
  it("引いた地図の線はまず寄せ、駅の印が出る倍率から駅の間を尋ねる", () => {
    expect(BETWEEN_PICK_MIN_ZOOM).toBe(STATION_LABEL_MIN_ZOOM);
    expect(selectRailTapAction(10.4, 2)).toBe("approach");
    expect(selectRailTapAction(BETWEEN_PICK_MIN_ZOOM, 1)).toBe("pick");
    expect(selectRailTapAction(15, 0)).toBe("none");
  });
});

// 北へふくらんだ架空の線路。2 駅を結ぶ直線から 500m ほど離れる
const curvedTrack: Position[][] = [
  [
    [135.49, 34.7],
    [135.495, 34.704],
    [135.5, 34.705],
    [135.505, 34.704],
    [135.51, 34.7],
  ],
];

describe("buildSegmentPath", () => {
  const from: Position = [135.49, 34.7];
  const to: Position = [135.51, 34.7];

  it("駅の間の点線を、2 駅を結ぶ直線ではなく線路の形に沿って切り出す", () => {
    const path = buildSegmentPath(curvedTrack, from, to);
    expect(path.length).toBeGreaterThan(2);
    // 点線の頂点はすべて線路の上にある
    for (const point of path) {
      expect(measurePathDistance(point, curvedTrack[0] ?? [])).toBeLessThan(1);
    }
    // 中ほどの丸も線路の上に置き、直線の中点からは離れる
    const middle = computePathMidpoint(path);
    if (!middle) throw new Error("中ほどの点がありません");
    expect(measurePathDistance(middle, curvedTrack[0] ?? [])).toBeLessThan(1);
    expect(
      measureSegmentDistance(middle, computeMidpoint(from, to), computeMidpoint(from, to)),
    ).toBeGreaterThan(400);
  });

  it("線路の形が無いか切り出せなければ、2 駅を結ぶ", () => {
    expect(buildSegmentPath(undefined, from, to)).toEqual([from, to]);
    expect(buildSegmentPath(curvedTrack, [135.3, 34.9], to)).toEqual([[135.3, 34.9], to]);
  });
});

describe("引いた地図の駅の間の丸", () => {
  it("押せる丸が取れなくても、丸の大きさの押して寄せる範囲を残し、駅の印には届かせない", () => {
    // 駅の印から 20px の駅の間の丸。選ぶ押せる丸は取れない
    const point = { x: 0, y: 0 };
    const station = { x: 20, y: 0 };
    expect(computeSegmentHitRadii([point], [{ point: station, radius: 24 }])).toEqual([null]);
    expect(computeSegmentApproachRadii([point], [station])).toEqual([12]);
    // 駅の印にほぼ重なる丸でも、丸の大きさは押せる
    expect(computeSegmentApproachRadii([point], [{ x: 6, y: 0 }])).toEqual([8]);
  });

  it("押して寄せる倍率は、駅の印の押せる丸から押せる丸の半径だけ離れる倍率にする", () => {
    const zoom = computeSegmentApproachZoom({
      zoom: 11,
      point: { x: 0, y: 0 },
      markerPoints: [{ x: 23, y: 0 }],
      otherPoints: [{ x: 60, y: 0 }],
    });
    // 23px が 46px 以上になる倍率。少なくとも 1 段は寄せる
    expect(zoom).toBeGreaterThanOrEqual(12);
    expect(23 * 2 ** (zoom - 11) - 24).toBeGreaterThanOrEqual(22);
    const radii = computeSegmentHitRadii(
      [{ x: 0, y: 0 }],
      [{ point: { x: 23 * 2 ** (zoom - 11), y: 0 }, radius: 24 }],
    );
    expect(radii[0]).not.toBeNull();
    // 上限の倍率を超えない
    expect(
      computeSegmentApproachZoom({
        zoom: 16.5,
        point: { x: 0, y: 0 },
        markerPoints: [{ x: 1, y: 0 }],
        otherPoints: [],
      }),
    ).toBe(17);
  });
});
