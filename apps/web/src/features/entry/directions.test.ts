import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import {
  listDirectionCandidates,
  listEntryDirections,
  listNearbyStops,
  pickSpreadStops,
} from "./directions";
import { createEntryData, type EntryLine, findStationChoice, listGroupLines } from "./entry-places";

// 実データで、方面の呼び名と行き先の候補が噛み合うか確かめる
const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);

function findLine(stationName: string, observedName: string): EntryLine {
  const group = data.catalog.groupById.get(stationName);
  const line = group
    ? listGroupLines(data, group).find((l) => l.observedName === observedName)
    : null;
  if (!line) throw new Error(`${stationName} の ${observedName} が見つかりません`);
  return line;
}

describe("listEntryDirections", () => {
  const midosuji = findLine("心斎橋", "地下鉄御堂筋線");
  const directions = listEntryDirections(data, midosuji);

  it("心斎橋の御堂筋線は、新大阪・千里中央方面と天王寺・なかもず方面を出す", () => {
    expect(directions.map((d) => d.label.ja)).toEqual(["新大阪・千里中央", "天王寺・なかもず"]);
    expect(directions.map((d) => d.label.en)).toEqual([
      "Shin-Osaka / Senri-Chuo",
      "Tennoji / Nakamozu",
    ]);
  });

  it("行き先の候補は地下鉄の駅から並べ、直通先の北大阪急行の駅は後ろに回す", () => {
    const north = directions[0];
    if (!north) throw new Error("北の方面がありません");
    const candidates = listDirectionCandidates(north);
    expect(candidates[0]?.choice.operators.map((o) => o.name)).toContain("Osaka Metro");
    expect(candidates[0]?.sameOperator).toBe(true);
    expect(candidates.map((c) => c.choice.name)).toEqual(
      expect.arrayContaining(["本町", "梅田", "新大阪"]),
    );
    // 呼び名に出した直通先の千里中央は候補に入れ、最後に回す
    expect(candidates.at(-1)?.choice.name).toBe("千里中央");
    expect(candidates.at(-1)?.sameOperator).toBe(false);
    expect(candidates.slice(0, -1).every((c) => c.sameOperator)).toBe(true);
  });

  it("呼び名に出した終点は、乗降客数が少なくても候補に入れる", () => {
    const [kyoto] = listEntryDirections(data, findLine("大阪梅田", "阪急京都線"));
    if (!kyoto) throw new Error("方面がありません");
    const names = listDirectionCandidates(kyoto).map((c) => c.choice.name);
    expect(names).toContain("京都河原町");
    expect(names).toContain("十三");
    expect(names).toHaveLength(5);
  });

  it("行き先を決めないときは、隣の駅を避けて方面の主な駅にする", () => {
    expect(directions.map((d) => [d.fallback.stop.choice.name, d.fallback.kind])).toEqual([
      ["新大阪", "hub"],
      ["天王寺", "hub"],
    ]);
  });

  it("電車の中の近い駅は、来た側の隣・選んだ駅・進む側の隣を道順に並べる", () => {
    const north = directions[0];
    if (!north) throw new Error("北の方面がありません");
    expect(listNearbyStops(data, midosuji, directions, north).map((s) => s.choice.name)).toEqual([
      "難波",
      "心斎橋",
      "本町",
    ]);
  });

  it("大阪の JR京都線は、京都の方面を先に出す", () => {
    const kyoto = listEntryDirections(data, findLine("大阪", "JR京都線"));
    expect(kyoto.map((d) => d.label.ja)).toEqual(["新大阪・京都", "尼崎・三ノ宮"]);
    expect(kyoto[0]?.fallback.stop.choice.name).toBe("京都");
  });

  it("大阪梅田の阪急は起点なので、方面は 1 つだけになる", () => {
    for (const name of ["阪急京都線", "阪急宝塚線", "阪急神戸線"]) {
      const line = findLine("大阪梅田", name);
      expect(listEntryDirections(data, line), name).toHaveLength(1);
    }
    expect(listEntryDirections(data, findLine("大阪梅田", "阪急京都線"))[0]?.label.ja).toBe(
      "京都河原町",
    );
  });

  it("終点の手前では、終点を行き先にする", () => {
    const line = findLine("新金岡", "地下鉄御堂筋線");
    const south = listEntryDirections(data, line).find((d) => d.stops.length === 1);
    expect(south?.fallback).toMatchObject({ kind: "terminal" });
    expect(south?.fallback.stop.choice.name).toBe(findStationChoice(data, "中百舌鳥")?.name);
  });
});

describe("pickSpreadStops", () => {
  it("地図の札は、現在地と互いから離れた駅だけを残す", () => {
    const line = findLine("心斎橋", "地下鉄御堂筋線");
    const [north] = listEntryDirections(data, line);
    const here = findStationChoice(data, "心斎橋");
    if (!north || !here) throw new Error("方面か駅がありません");
    const names = pickSpreadStops(listDirectionCandidates(north), [here.lon, here.lat]).map(
      (s) => s.choice.name,
    );
    // 隣の本町は現在地に近く、西中島南方は新大阪に近いので出さない
    expect(names).toContain("新大阪");
    expect(names).toContain("梅田");
    expect(names).not.toContain("本町");
    expect(names).not.toContain("西中島南方");
  });
});
