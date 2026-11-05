import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import {
  listDirectionCandidates,
  listEntryDirections,
  listNearbyStops,
  listTrainPositionStops,
  mergeDirectionCandidates,
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
    // 隣の本町は行き先としてはまれなので最後に回す
    expect(candidates.at(-1)?.choice.name).toBe("本町");
    expect(candidates[0]?.choice.name).not.toBe("本町");
    // 呼び名に出した直通先の千里中央は候補に入れ、地下鉄の主な駅の後ろに回す
    const names = candidates.map((c) => c.choice.name);
    const senri = names.indexOf("千里中央");
    expect(senri).toBe(names.length - 2);
    expect(candidates.at(senri)?.sameOperator).toBe(false);
    expect(candidates.slice(0, senri).every((c) => c.sameOperator)).toBe(true);
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

describe("mergeDirectionCandidates", () => {
  it("方面を決める前の候補は、両方面をつないでも隣の駅を末尾に回す", () => {
    const midosuji = findLine("心斎橋", "地下鉄御堂筋線");
    const directions = listEntryDirections(data, midosuji);
    const merged = mergeDirectionCandidates(directions);
    const adjacent = directions.map((d) => d.stops[0]?.choice.id);
    const names = merged.map((s) => s.choice.id);
    expect(new Set(names).size).toBe(names.length);
    const firstAdjacent = names.findIndex((id) => adjacent.includes(id));
    const lastOther = names.map((id) => !adjacent.includes(id)).lastIndexOf(true);
    expect(firstAdjacent).toBeGreaterThan(lastOther);
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

describe("京都と神戸の路線", () => {
  it.each([
    ["東寺", "近鉄京都線", ["京都", "大和西大寺・橿原神宮前"]],
    ["七条", "京阪本線", ["三条・出町柳", "枚方市・淀屋橋"]],
    ["神戸三宮", "阪神本線", ["尼崎・大阪梅田", "元町・高速神戸"]],
  ])("%s の %s は駅で見る方面名と行き先を持つ", (station, observedName, labels) => {
    const directions = listEntryDirections(data, findLine(station, observedName));
    expect(directions.map((direction) => direction.label.ja).sort()).toEqual([...labels].sort());
    for (const direction of directions) {
      const candidates = listDirectionCandidates(direction);
      expect(candidates.length).toBeGreaterThan(0);
      for (const landmark of direction.landmarks) {
        expect(candidates).toContain(landmark);
        expect(landmark.choice.nameEn).toBeTruthy();
      }
      expect(direction.label.en).not.toMatch(/[一-龯]/);
    }
  });
});

describe("listTrainPositionStops", () => {
  it("基準の駅の手前も含めて進行方向に並べ、選んだ駅間から方面を引き直せる", () => {
    const line = findLine("大阪", "JR神戸線");
    const direction = listEntryDirections(data, line).find((d) => d.label.ja.includes("三ノ宮"));
    if (!direction) throw new Error("方面がありません");
    const names = listTrainPositionStops(data, line, direction).map((s) => s.choice.name);
    const osaka = names.indexOf("大阪");
    expect(names.slice(osaka - 1, osaka + 3)).toEqual(["新大阪", "大阪", "塚本", "尼崎"]);
    const changed = listEntryDirections(data, { ...line, stationName: "塚本" }).find(
      (d) => d.stops[0]?.choice.name === "尼崎",
    );
    expect(changed?.stops[0]?.choice.name).toBe("尼崎");
  });
  it("方面の呼び名に含めた直通先を駅間の候補には入れない", () => {
    const line = findLine("心斎橋", "地下鉄御堂筋線");
    const direction = listEntryDirections(data, line)[0];
    if (!direction) throw new Error("方面がありません");
    const names = listTrainPositionStops(data, line, direction).map((s) => s.choice.name);
    expect(names).toContain("江坂");
    expect(names).not.toContain("千里中央");
  });
});

it("駅にいる人の行き先候補は両方面から出し、地図にも選べる主な駅を残す", () => {
  const group = data.catalog.groupById.get("心斎橋");
  if (!group) throw new Error("駅がありません");
  const candidates = listGroupLines(data, group)
    .flatMap((line) => listEntryDirections(data, line))
    .flatMap((direction) => listDirectionCandidates(direction))
    .filter((stop, i, stops) => stops.findIndex((s) => s.choice.id === stop.choice.id) === i);
  expect(candidates.map((s) => s.choice.name)).toEqual(expect.arrayContaining(["梅田", "難波"]));
  expect(
    pickSpreadStops(candidates, [group.choice.lon, group.choice.lat]).map((s) => s.choice.name),
  ).toContain("梅田");
});
