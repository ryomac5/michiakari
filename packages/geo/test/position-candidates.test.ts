import { describe, expect, it } from "vitest";
import {
  applyNetworkCorrections,
  findPositionCandidates,
  type LonLat,
  POSITION_THRESHOLDS,
  type PositionCandidate,
} from "../src/index.ts";
import { loadNetworkData } from "../src/node.ts";

// 端末の位置から、いる駅か駅の間を推定する。network.json の実際の駅と路線で確かめる

const network = applyNetworkCorrections(loadNetworkData());

function findLonLat(stationId: string): LonLat {
  const node = network.nodes.find((n) => n.stationId === stationId);
  if (!node) throw new Error(`${stationId} がありません`);
  return node.lonLat;
}

function computeMidpoint(a: string, b: string): LonLat {
  const [ax, ay] = findLonLat(a);
  const [bx, by] = findLonLat(b);
  return [(ax + bx) / 2, (ay + by) / 2];
}

function describeCandidate(c: PositionCandidate): string {
  return c.kind === "station"
    ? `station:${c.station.name}`
    : `between:${c.line.lineId}:${c.from.name}-${c.to.name}`;
}

describe("findPositionCandidates", () => {
  it("駅の代表点の上では駅を先に、その駅を端に持つ駅の間も近い順に返す", () => {
    const candidates = findPositionCandidates(network, {
      lonLat: findLonLat("jr-west.東海道線.大阪"),
      accuracyMeters: 20,
    });
    const labels = candidates.map(describeCandidate);
    expect(labels[0]).toBe("station:大阪");
    expect(labels).toContain("between:jr-west.東海道線:大阪-塚本");
    expect(labels.filter((l) => l.startsWith("station:"))).toEqual(["station:大阪"]);
    const distances = candidates.map((c) => c.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("駅の間が 400m より短くても、その駅の間を返す", () => {
    const candidates = findPositionCandidates(network, {
      lonLat: computeMidpoint("hankai.上町線.帝塚山四丁目", "hankai.上町線.神ノ木"),
      accuracyMeters: 10,
    });
    expect(candidates.map(describeCandidate)).toContain(
      "between:hankai.上町線:帝塚山四丁目-神ノ木",
    );
  });

  it("駅の近くで線から横に離れ、駅の候補に入らない位置でも、駅の間を返す", () => {
    // 塚本から尼崎へ線の上を 190m 進み、線から横に 120m 離れた点
    const [ax, ay] = findLonLat("jr-west.東海道線.塚本");
    const [bx, by] = findLonLat("jr-west.東海道線.尼崎");
    const scale = Math.cos((ay * Math.PI) / 180);
    const dx = (bx - ax) * scale;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const along = 190 / 111_320 / length;
    const side = 120 / 111_320 / length;
    const lonLat: LonLat = [ax + (dx * along - dy * side) / scale, ay + dy * along + dx * side];
    const candidates = findPositionCandidates(network, { lonLat, accuracyMeters: 0 });
    expect(candidates.map(describeCandidate)).toEqual(["between:jr-west.東海道線:塚本-尼崎"]);
  });

  it("JR神戸線の塚本と尼崎の間では、その駅の間を返す", () => {
    const candidates = findPositionCandidates(network, {
      lonLat: computeMidpoint("jr-west.東海道線.塚本", "jr-west.東海道線.尼崎"),
      accuracyMeters: 20,
    });
    expect(candidates.map(describeCandidate)).toEqual(["between:jr-west.東海道線:塚本-尼崎"]);
    const [first] = candidates;
    expect(first?.distanceMeters).toBeLessThan(5);
  });

  it("阪急神戸線と宝塚線が並んで走る中津と十三の間では、両方の路線を近い順に返す", () => {
    const candidates = findPositionCandidates(network, {
      lonLat: computeMidpoint("hankyu.神戸線.中津", "hankyu.神戸線.十三"),
      accuracyMeters: 20,
    });
    const between = candidates.filter((c) => c.kind === "between");
    const lineIds = between.map((c) => c.line.lineId);
    expect(lineIds).toContain("hankyu.神戸線");
    expect(lineIds).toContain("hankyu.宝塚線");
    expect(candidates[0]).toMatchObject({ kind: "between", line: { lineId: "hankyu.神戸線" } });
    const distances = candidates.map((c) => c.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("精度が悪いと、近い駅と駅の間を複数、近い順に返す", () => {
    const point = findLonLat("jr-west.東海道線.大阪");
    const precise = findPositionCandidates(network, { lonLat: point, accuracyMeters: 20 });
    const rough = findPositionCandidates(network, { lonLat: point, accuracyMeters: 400 });
    expect(rough.length).toBeGreaterThan(precise.length);
    expect(rough[0]).toMatchObject({ kind: "station", station: { name: "大阪" } });
    expect(rough.filter((c) => c.kind === "station").length).toBeGreaterThan(1);
    expect(rough.map(describeCandidate)).toContain("station:梅田");
    const distances = rough.map((c) => c.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("駅からも線からも離れた場所と、精度が粗すぎる位置では、空を返す", () => {
    // 大阪湾の上
    expect(findPositionCandidates(network, { lonLat: [135.3, 34.55], accuracyMeters: 20 })).toEqual(
      [],
    );
    expect(
      findPositionCandidates(network, {
        lonLat: findLonLat("jr-west.東海道線.大阪"),
        accuracyMeters: POSITION_THRESHOLDS.maxAccuracyMeters + 1,
      }),
    ).toEqual([]);
  });
});
