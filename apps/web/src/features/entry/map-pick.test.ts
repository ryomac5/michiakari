import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import { type DirectionStop, listEntryDirections } from "./directions";
import {
  createEntryData,
  type EntryLine,
  type Position,
  resolveConfiguredArea,
} from "./entry-places";
import { listTrainLines } from "./infer-route";
import {
  computeSegmentHitRadii,
  findNearestLineId,
  findNearestSegment,
  isOnRoute,
  listLinePicks,
  listRouteStops,
  listSegmentWindow,
  measureSegmentDistance,
  mergeRouteCandidates,
  pickLineAt,
  selectAwaySide,
} from "./map-pick";

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
