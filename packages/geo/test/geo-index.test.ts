import { describe, expect, it } from "vitest";
import { LINE_TYPES, normalizeSearchText } from "../src/index.ts";
import { loadGeoIndex, loadGeoMeta, loadNetworkData } from "../src/node.ts";

const network = loadNetworkData();
const geo = loadGeoIndex();

function findStation(name: string, lineId: string) {
  const station = geo.findStationsByName(name, 100).find((s) => s.lineId === lineId);
  if (!station) throw new Error(`${lineId} の ${name} が見つかりません`);
  return station;
}

function findEdge(lineId: string, a: string, b: string) {
  const ids = new Set([findStation(a, lineId).stationId, findStation(b, lineId).stationId]);
  return network.edges.find((e) => e.lineId === lineId && ids.has(e.from) && ids.has(e.to));
}

describe("主要駅", () => {
  it.each(["大阪", "京都", "三ノ宮", "神戸三宮", "難波", "天王寺", "梅田", "大阪梅田"])(
    "%s が存在する",
    (name) => {
      expect(geo.findStationsByName(name).some((s) => s.name === name)).toBe(true);
    },
  );
});

describe("findStationsByName", () => {
  it("ひらがなの読みで探せる", () => {
    const names = geo.findStationsByName("うめだ").map((s) => s.name);
    expect(names).toContain("梅田");
    expect(names).toContain("大阪梅田");
  });

  it("部分一致で探せる", () => {
    expect(geo.findStationsByName("阿部野").some((s) => s.name === "大阪阿部野橋")).toBe(true);
  });

  it("三宮で三ノ宮も見つかる", () => {
    expect(geo.findStationsByName("三宮").some((s) => s.name === "三ノ宮")).toBe(true);
  });

  it("完全一致を部分一致より先に返す", () => {
    expect(geo.findStationsByName("大阪")[0]?.name).toBe("大阪");
  });

  it("空の検索語には何も返さない", () => {
    expect(geo.findStationsByName("  ")).toEqual([]);
  });
});

describe("normalizeSearchText", () => {
  it("カタカナをひらがなにし、駅を除く", () => {
    expect(normalizeSearchText("ユニバーサルシティ駅")).toBe("ゆにばーさるしてぃ");
  });
});

describe("事業者の正規化", () => {
  it("泉北線の事業者は南海", () => {
    const line = geo.getLine("nankai.泉北線");
    expect(line?.operator).toBe("南海");
    expect(line?.segments[0]?.stationIds.length).toBeGreaterThanOrEqual(6);
    expect(geo.findStationsByName("和泉中央").every((s) => s.operator === "南海")).toBe(true);
  });
});

describe("隣接駅と距離", () => {
  it("JR京都線（東海道線）は高槻・島本・山崎の順に並び、高槻から山崎は数km", () => {
    const lineId = "jr-west.東海道線";
    const takatsukiShimamoto = findEdge(lineId, "高槻", "島本");
    const shimamotoYamazaki = findEdge(lineId, "島本", "山崎");
    expect(takatsukiShimamoto).toBeDefined();
    expect(shimamotoYamazaki).toBeDefined();
    const total = (takatsukiShimamoto?.distanceKm ?? 0) + (shimamotoYamazaki?.distanceKm ?? 0);
    expect(total).toBeGreaterThan(5);
    expect(total).toBeLessThan(10);
    const between = geo.listLinesBetween(
      findStation("高槻", lineId).stationId,
      findStation("山崎", lineId).stationId,
    );
    expect(between.find((b) => b.line.lineId === lineId)?.distanceKm).toBeCloseTo(total, 5);
  });

  it("阪急神戸線の岡本と御影が隣接する", () => {
    const edge = findEdge("hankyu.神戸線", "岡本", "御影");
    expect(edge?.lineType).toBe("private_express");
    expect(edge?.distanceKm).toBeGreaterThan(1);
    expect(edge?.distanceKm).toBeLessThan(4);
  });

  it("大阪環状線は環状の区間になる", () => {
    const segment = geo.getLine("jr-west.大阪環状線")?.segments[0];
    expect(segment?.loop).toBe(true);
    expect(segment?.lengthKm).toBeGreaterThan(20);
    expect(segment?.lengthKm).toBeLessThan(23);
  });
});

describe("乗換", () => {
  it("JR大阪と地下鉄梅田が乗換で結ばれる", () => {
    const osaka = findStation("大阪", "jr-west.東海道線");
    const transfers = geo.listTransfers(osaka.stationId);
    const umeda = transfers.find((t) => t.station.stationId === "osaka-metro.御堂筋線.梅田");
    expect(umeda).toBeDefined();
    expect(umeda?.walkMeters).toBeLessThanOrEqual(300);
  });
});

describe("findNearestStations", () => {
  it("大阪駅付近の座標から大阪駅を返す", () => {
    const nearest = geo.findNearestStations([135.4959, 34.7025], 3);
    expect(nearest).toHaveLength(3);
    expect(nearest.some((n) => n.station.name === "大阪")).toBe(true);
    expect(nearest[0]?.distanceMeters).toBeLessThan(300);
  });
});

describe("buildNetworkGraph", () => {
  it("乗車と乗換の辺を双方向に持つ", () => {
    const graph = geo.buildNetworkGraph();
    const okamoto = findStation("岡本", "hankyu.神戸線");
    const mikage = findStation("御影", "hankyu.神戸線");
    expect(graph.get(okamoto.stationId)?.some((l) => l.to === mikage.stationId)).toBe(true);
    expect(graph.get(mikage.stationId)?.some((l) => l.to === okamoto.stationId)).toBe(true);
    const osaka = findStation("大阪", "jr-west.東海道線");
    expect(graph.get(osaka.stationId)?.some((l) => l.kind === "transfer")).toBe(true);
  });
});

describe("データの整合", () => {
  it("辺と乗換の端点はすべてノードにある", () => {
    const ids = new Set(network.nodes.map((n) => n.stationId));
    for (const e of network.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    }
    for (const t of network.transfers) {
      expect(ids.has(t.from) && ids.has(t.to)).toBe(true);
    }
  });

  it("駅 ID は一意で URL に使える", () => {
    const ids = network.nodes.map((n) => n.stationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).not.toMatch(/[\s/?#&()（）]/);
  });

  it("路線種別と色が決まっている", () => {
    for (const line of network.lines) {
      expect(LINE_TYPES).toContain(line.lineType);
      expect(line.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("meta に出典がある", () => {
    const meta = loadGeoMeta();
    expect(meta.attribution.join("\n")).toContain("国土数値情報（鉄道データ）");
    expect(meta.counts.stations).toBe(network.nodes.length);
  });
});
