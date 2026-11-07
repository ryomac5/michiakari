import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { buildTrackShapes, createMapGeo, type LinesGeoJson } from "@/features/map/geo-data";
import { listEntryDirections } from "./directions";
import { createEntryData, findStationChoice, listGroupLines } from "./entry-places";
import {
  type GpsSegment,
  inferSegmentTravel,
  listGpsChoices,
  listLineTapChoices,
  listSegmentDirections,
  listSegmentTravels,
  listStationPairChoices,
  resolveSegmentTravel,
} from "./gps-candidates";

const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);
const trackShapes = buildTrackShapes(
  JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve("@repo/geo/data/lines.geojson"), "utf8"),
  ) as LinesGeoJson,
);

function findPoint(name: string) {
  const choice = findStationChoice(data, name);
  if (!choice) throw new Error(`${name} がありません`);
  return choice;
}

// 塚本と尼崎の中間。JR神戸線の線の上
const tsukamoto = findPoint("塚本");
const amagasaki = findPoint("尼崎");
const between = {
  lat: (tsukamoto.lat + amagasaki.lat) / 2,
  lon: (tsukamoto.lon + amagasaki.lon) / 2,
  accuracy: 20,
};

function locateBetween() {
  const [choice] = listGpsChoices(data, geo.nodes, between);
  if (choice?.kind !== "between") throw new Error("駅の間の候補がありません");
  return choice;
}

// 路線を、その路線の駅の名前の位置に置く
function placeLine(lineId: string, stationName: string) {
  const group = data.catalog.groupById.get(stationName);
  const line = group ? listGroupLines(data, group).find((l) => l.lineId === lineId) : undefined;
  if (!line) throw new Error(`${stationName} に ${lineId} がありません`);
  return line;
}

function describeTravels(lineId: string, segment: GpsSegment) {
  return listSegmentTravels(data, placeLine(lineId, segment.from), segment).map(
    (t) =>
      `${t.line.stationName}>${t.direction.stops[0]?.choice.name}>${t.direction.stops.at(-1)?.choice.name}`,
  );
}

describe("listGpsChoices", () => {
  it("駅の間を JR の通称の路線と 2 駅で返す", () => {
    const choices = listGpsChoices(data, geo.nodes, between);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      kind: "between",
      line: { observedName: "JR神戸線", stationName: "塚本" },
      from: { name: "塚本" },
      to: { name: "尼崎" },
    });
  });
  it("線から離れた駅の近くでは駅だけを返し、駅の上では駅を先に駅の間も最大 3 つまで返す", () => {
    // 塚本から北東へ 175m。線からは 150m より離れている
    const nearTsukamoto = { lat: 34.714091, lon: 135.469846, accuracy: 10 };
    expect(listGpsChoices(data, geo.nodes, nearTsukamoto)).toMatchObject([
      { kind: "station", choice: { name: "塚本" } },
    ]);
    // JR大阪駅のホームの上
    const onOsaka = listGpsChoices(data, geo.nodes, {
      lat: 34.70249,
      lon: 135.49465,
      accuracy: 20,
    });
    expect(onOsaka).toHaveLength(3);
    expect(onOsaka[0]).toMatchObject({ kind: "station", choice: { name: "大阪" } });
    expect(onOsaka.slice(1).every((c) => c.kind === "between")).toBe(true);
  });
});

describe("駅の間の進む向き", () => {
  it("行き先がある側へ進み、次の駅を方面の先頭にする", () => {
    const choice = locateBetween();
    const travels = listSegmentTravels(data, choice.line, {
      from: choice.from.name,
      to: choice.to.name,
    });
    const west = inferSegmentTravel(travels, findPoint("三ノ宮"));
    expect(west?.line.stationName).toBe("塚本");
    expect(west?.direction.stops[0]?.choice.name).toBe("尼崎");
    const east = inferSegmentTravel(travels, findPoint("大阪"));
    expect(east?.line.stationName).toBe("尼崎");
    expect(east?.direction.stops[0]?.choice.name).toBe("塚本");
    expect(inferSegmentTravel(travels, findPoint("心斎橋"))).toBeNull();
  });

  it("次の駅で路線が分かれる山陽線の神戸〜兵庫では、分かれた先の方面もすべて持ち、和田岬へも決められる", () => {
    const segment = { from: "神戸", to: "兵庫" };
    expect(describeTravels("jr-west.山陽線", segment)).toEqual(
      expect.arrayContaining(["神戸>兵庫>英賀保", "神戸>兵庫>和田岬"]),
    );
    const travels = listSegmentTravels(data, placeLine("jr-west.山陽線", "神戸"), segment);
    const wadamisaki = inferSegmentTravel(travels, findPoint("和田岬"));
    expect(wadamisaki?.line.stationName).toBe("神戸");
    expect(wadamisaki?.direction.stops.map((s) => s.choice.name)).toEqual(["兵庫", "和田岬"]);
    expect(wadamisaki?.direction.key.endsWith("和田岬")).toBe(true);
    // 分かれる前の兵庫が行き先なら、どの方面でも位置は同じなので決まる
    expect(inferSegmentTravel(travels, findPoint("兵庫"))?.line.stationName).toBe("神戸");
  });

  it("終点を含む叡山本線の出町柳〜元田中では、方面の段で終点の出町柳へ向かう向きも選べる", () => {
    const segment = { from: "出町柳", to: "元田中" };
    const line = placeLine("eiden.叡山本線", "出町柳");
    const options = listSegmentDirections(data, line, segment);
    expect(options.map((d) => d.stops[0]?.choice.name)).toEqual(["元田中", "出町柳"]);
    const travels = listSegmentTravels(data, line, segment);
    const toTerminal = options.find((d) => d.stops[0]?.choice.name === "出町柳");
    if (!toTerminal) throw new Error("出町柳へ向かう方面がありません");
    expect(resolveSegmentTravel(travels, toTerminal)?.line.stationName).toBe("元田中");
  });

  it("JR環状線の福島〜大阪では、方面の段のどの向きを選んでも駅の間を通る向きに対応づく", () => {
    const segment = { from: "福島", to: "大阪" };
    const line = placeLine("jr-west.大阪環状線", "福島");
    const travels = listSegmentTravels(data, line, segment);
    const resolved = listSegmentDirections(data, line, segment).map((d) => {
      const travel = resolveSegmentTravel(travels, d);
      return travel && `${travel.line.stationName}>${travel.direction.stops[0]?.choice.name}`;
    });
    expect(resolved).toEqual(["福島>大阪", "大阪>福島"]);
    // 福島から大阪と逆へ向かう方面は、この駅の間を通らないので対応づけない
    const away = listEntryDirections(data, line).find((d) => d.stops[0]?.choice.name !== "大阪");
    if (!away) throw new Error("福島から野田へ向かう方面がありません");
    expect(resolveSegmentTravel(travels, away)).toBeNull();
  });
});

describe("listLineTapChoices", () => {
  const kobe = "jr-west.東海道線";
  const tozai = "jr-west.JR東西線";
  // 描いた JR神戸線の上で、塚本と尼崎の中ほどに一番近い点。駅を結ぶ直線から約650m 北にある
  const onDrawnTrack = { lat: 34.727764, lon: 135.452974 };
  // 描いた JR神戸線の上で、ほかの路線の線から約700m 離れた点。e2e で押す点
  const awayFromOthers = { lat: 34.718828, lon: 135.463484 };

  it("塚本と尼崎の間の線を押すと、JR神戸線の塚本〜尼崎の間を 1 つだけ出す", () => {
    for (const point of [between, onDrawnTrack, awayFromOthers]) {
      const choices = listLineTapChoices(data, geo.nodes, point, 120, [kobe]);
      expect(choices).toHaveLength(1);
      const [first] = choices;
      if (first?.kind !== "between") throw new Error("駅の間の候補がありません");
      expect(first.line.name.ja).toBe("JR神戸線");
      expect([first.from.name, first.to.name].sort()).toEqual(["塚本", "尼崎"].sort());
    }
  });

  it("並んで走る路線を押すと、路線ごとに一番近い駅の間を近い順に 3 つまで出す", () => {
    const choices = listLineTapChoices(data, geo.nodes, onDrawnTrack, 120, [kobe, tozai]);
    expect(choices.map((c) => (c.kind === "between" ? c.line.lineId : ""))).toEqual(
      expect.arrayContaining([kobe, tozai]),
    );
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(choices.every((c) => c.kind === "between")).toBe(true);
  });

  it("引いた地図で押すと、画面で拾った線の順ではなく、線路の形が押した点に近い順に並べる", () => {
    // 開いた直後の倍率で 44px を地図の距離にした値。画面の線は東西線が先に拾われたとする
    const lowZoomReach = 4400;
    const choices = listLineTapChoices(
      data,
      geo.nodes,
      awayFromOthers,
      lowZoomReach,
      [tozai, kobe],
      trackShapes,
    );
    expect(choices.map((c) => (c.kind === "between" ? c.line.lineId : ""))).toEqual([kobe, tozai]);
  });

  it("開いた直後の倍率で、駅を結ぶ直線から大きく曲がった線の上を押しても、その駅の間を出す", () => {
    // けいはんな線の生駒〜白庭台は、描いた線が駅を結ぶ直線から約1500m 離れる。その頂の点を押す
    // 開いた直後の倍率 9.3 では、44px は約4500m になる。GPS の精度の上限 1000m では見つからなかった
    const keihanna = "kintetsu.けいはんな線";
    const bend = { lon: 135.71796, lat: 34.69478 };
    const choices = listLineTapChoices(data, geo.nodes, bend, 4500, [keihanna], trackShapes);
    const [first] = choices;
    if (first?.kind !== "between") throw new Error("駅の間の候補がありません");
    expect([first.from.name, first.to.name].sort()).toEqual(["生駒", "白庭台"].sort());
  });

  it("寄った地図では、描いた線から押した幅より離れた駅の間を出さない", () => {
    // 曲がりの頂から北へ約300m。寄った地図の 44px（約100m）の半分より遠い
    const keihanna = "kintetsu.けいはんな線";
    const away = { lon: 135.71796, lat: 34.69748 };
    expect(listLineTapChoices(data, geo.nodes, away, 100, [keihanna], trackShapes)).toEqual([]);
  });

  it("押した線から離れた所や、線の無い所では候補を出さない", () => {
    expect(listLineTapChoices(data, geo.nodes, { lat: 34.3, lon: 135.9 }, 120, [kobe])).toEqual([]);
    expect(listLineTapChoices(data, geo.nodes, between, 120, [])).toEqual([]);
  });
});

describe("listStationPairChoices", () => {
  // 候補を「路線:手前の駅〜先の駅」で並べる
  function describePairs(first: string, second: string) {
    return listStationPairChoices(data, geo.nodes, findPoint(first), findPoint(second)).map((c) =>
      c.kind === "between" ? `${c.line.name.ja}:${c.from.name}〜${c.to.name}` : c.key,
    );
  }

  it("隣り合う 2 駅は、その駅の間を 1 つだけ返し、1 つ目の駅を手前にする", () => {
    expect(describePairs("塚本", "尼崎")).toEqual(["JR神戸線:塚本〜尼崎"]);
    expect(describePairs("尼崎", "塚本")).toEqual(["JR神戸線:尼崎〜塚本"]);
    const [choice] = listStationPairChoices(data, geo.nodes, tsukamoto, amagasaki);
    expect(choice).toMatchObject({
      kind: "between",
      key: "between:jr-west.東海道線:塚本:尼崎",
      line: { lineId: "jr-west.東海道線", observedName: "JR神戸線" },
    });
  });

  it("間に駅があれば、間の駅の並びを道順に返す", () => {
    expect(describePairs("大阪", "尼崎")).toEqual(["JR神戸線:大阪〜塚本", "JR神戸線:塚本〜尼崎"]);
    // 環状の路線は短い回り方の並びにする
    expect(describePairs("京橋", "大阪")).toEqual([
      "JR環状線:京橋〜桜ノ宮",
      "JR環状線:桜ノ宮〜天満",
      "JR環状線:天満〜大阪",
    ]);
  });

  it("並走する路線は、隣り合う路線を先にしてどれも返す", () => {
    expect(describePairs("天王寺", "新今宮")).toEqual([
      "JR環状線:天王寺〜新今宮",
      "JR大和路線:天王寺〜新今宮",
    ]);
    expect(describePairs("十三", "大阪梅田")).toEqual([
      "阪急京都線:十三〜大阪梅田",
      "阪急宝塚線:十三〜中津",
      "阪急宝塚線:中津〜大阪梅田",
      "阪急神戸線:十三〜中津",
      "阪急神戸線:中津〜大阪梅田",
    ]);
  });

  it("2 駅を通る路線が無いか、同じ駅なら空を返す", () => {
    expect(describePairs("塚本", "難波")).toEqual([]);
    expect(describePairs("塚本", "塚本")).toEqual([]);
  });

  it("並びが長ければ上限までに絞る", () => {
    const choices = listStationPairChoices(data, geo.nodes, findPoint("大阪"), findPoint("三ノ宮"));
    expect(choices).toHaveLength(8);
    expect(listStationPairChoices(data, geo.nodes, tsukamoto, amagasaki, 0)).toEqual([]);
  });
});
