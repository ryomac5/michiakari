import { ACCESS_WALK_MAX_MINUTES, ACCESS_WALK_MAX_MINUTES_EXTENDED } from "@repo/core";
import { describe, expect, it } from "vitest";
import {
  applyNetworkCorrections,
  buildNetworkGraph,
  listWalkAccessStations,
} from "../src/index.ts";
import { loadNetworkData } from "../src/node.ts";
import { isSameStation } from "../src/walk-access.ts";

// 地図の吹き出しと代替手段の探索が、同じ関数で歩いて乗りに行ける駅を選ぶ

const network = applyNetworkCorrections(loadNetworkData());
const graph = buildNetworkGraph(network);
const tokaido = "jr-west.東海道線";

function findNode(stationId: string) {
  const node = network.nodes.find((n) => n.stationId === stationId);
  if (!node) throw new Error(`${stationId} がありません`);
  return node;
}

function listStations(originId: string, maxWalkMinutes: number, blockedLineIds = [tokaido]) {
  return listWalkAccessStations({
    nodes: network.nodes,
    graph,
    origin: findNode(originId),
    blockedLineIds,
    maxWalkMinutes,
  });
}

describe("listWalkAccessStations: 塚本", () => {
  const origin = `${tokaido}.塚本`;

  it("乗換の辺が無く、通常の上限の中に別の鉄道の駅は無い", () => {
    expect(graph.get(origin)?.filter((l) => l.kind === "transfer")).toEqual([]);
    expect(listStations(origin, ACCESS_WALK_MAX_MINUTES)).toEqual([]);
  });

  it("広げた上限まで歩けば、御幣島・姫島・十三に着く。徒歩の短い順で、概算の分を使う", () => {
    const stations = listStations(origin, ACCESS_WALK_MAX_MINUTES_EXTENDED);
    const names = stations.map((s) => s.station.name);
    expect(new Set(names)).toEqual(new Set(["御幣島", "姫島", "十三"]));
    expect(names[0]).toBe("御幣島");
    expect(stations.every((s) => s.source === "estimate")).toBe(true);
    const minutes = stations.map((s) => s.walkMinutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(Math.max(...minutes)).toBeLessThanOrEqual(ACCESS_WALK_MAX_MINUTES_EXTENDED);
  });

  it("止まっている路線の駅は含めない", () => {
    const stations = listStations(origin, 60);
    expect(stations.some((s) => s.station.lineId === tokaido)).toBe(false);
    const open = listStations(origin, 60, []);
    expect(open.some((s) => s.station.lineId === tokaido)).toBe(true);
  });
});

describe("listWalkAccessStations: 大阪", () => {
  const origin = `${tokaido}.大阪`;
  const stations = listStations(origin, ACCESS_WALK_MAX_MINUTES);
  const ids = new Set(stations.map((s) => s.station.stationId));

  it("地図に手で整えた梅田一帯の駅は、すべて通常の上限の中の候補に入る", () => {
    for (const id of [
      "osaka-metro.御堂筋線.梅田",
      "hankyu.神戸線.大阪梅田",
      "hankyu.京都線.大阪梅田",
      "hankyu.宝塚線.大阪梅田",
      "hanshin.本線.大阪梅田",
      "jr-west.JR東西線.北新地",
      "osaka-metro.谷町線.東梅田",
      "osaka-metro.四つ橋線.西梅田",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("乗換の辺がある駅は路線データの徒歩を、無い駅は概算を使う", () => {
    const bySource = new Map(stations.map((s) => [s.station.stationId, s]));
    const hankyu = bySource.get("hankyu.神戸線.大阪梅田");
    const transfer = (graph.get(origin) ?? []).find(
      (l) => l.kind === "transfer" && l.to === "hankyu.神戸線.大阪梅田",
    );
    expect(hankyu?.source).toBe("transfer");
    expect(hankyu?.walkMinutes).toBe(transfer?.kind === "transfer" ? transfer.walkMinutes : -1);
    expect(bySource.get("jr-west.JR東西線.北新地")?.source).toBe("estimate");
  });

  it("現在地と同じ駅の路線違いは含めない", () => {
    const here = findNode(origin);
    expect(stations.some((s) => isSameStation(s.station, here))).toBe(false);
    expect(ids.has(origin)).toBe(false);
  });
});

describe("isSameStation", () => {
  it("名前と事業者が同じで近い駅だけが同じ駅", () => {
    const osaka = findNode(`${tokaido}.大阪`);
    expect(isSameStation(osaka, findNode("jr-west.大阪環状線.大阪"))).toBe(true);
    // 事業者が違う同名の駅は、歩いて乗り換える別の駅
    expect(isSameStation(osaka, findNode("hankyu.神戸線.大阪梅田"))).toBe(false);
    expect(isSameStation(findNode("hankyu.宝塚線.宝塚"), findNode("jr-west.福知山線.宝塚"))).toBe(
      false,
    );
  });
});
