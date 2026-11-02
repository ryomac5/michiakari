import { createGeoIndex, type NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import {
  buildStationCatalog,
  describeStationNames,
  findNearestChoices,
  LocationRequestSchema,
  searchStationChoices,
} from "./catalog";
import { describeStationLines, formatDistance } from "./describe";

// 国土数値情報の実データ（packages/geo/data）で確かめる
const network = networkJson as unknown as NetworkData;
const index = createGeoIndex(network);
const catalog = buildStationCatalog(network.nodes, network.lines);

function searchNames(query: string): string[] {
  return searchStationChoices(index, catalog, query).map((s) => s.name);
}

describe("buildStationCatalog", () => {
  it("同名で近くにある別事業者の駅を 1 つにまとめる", () => {
    const umeda = catalog.groupById.get("大阪梅田");
    expect(umeda?.choice.operators.map((o) => o.name).sort()).toEqual(["阪急", "阪神"]);
    expect(catalog.groupById.get("大阪")?.choice.operators.map((o) => o.name)).toEqual([
      "JR西日本",
    ]);
  });

  it("全駅をどこかのまとまりに入れ、識別子は重ならない", () => {
    expect(catalog.groupIdByStationId.size).toBe(network.nodes.length);
    const ids = catalog.groups.map((g) => g.choice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("同名でも離れた駅は別にする（東大阪と神戸の「長田」）", () => {
    const nagata = catalog.groups.filter((g) => g.choice.name === "長田");
    expect(nagata.length).toBeGreaterThanOrEqual(2);
    expect(nagata[0]?.choice.id).toBe("長田");
    const higashiOsaka = nagata.find((g) =>
      g.choice.operators.some((o) => o.name === "Osaka Metro"),
    );
    expect(higashiOsaka?.choice.operators.map((o) => o.name).sort()).toEqual([
      "Osaka Metro",
      "近鉄",
    ]);
  });
});

describe("searchStationChoices", () => {
  it("大阪と大阪梅田は別の候補で、完全一致を先頭に出す", () => {
    const names = searchNames("大阪");
    expect(names[0]).toBe("大阪");
    expect(names).toContain("大阪梅田");
  });

  it("よみがな・カタカナ・ローマ字でも探せる", () => {
    expect(searchNames("さんのみや")).toEqual(expect.arrayContaining(["三ノ宮", "三宮"]));
    expect(searchNames("コウベサンノミヤ")).toContain("神戸三宮");
    expect(searchNames("三ノ宮")[0]).toBe("三ノ宮");
    expect(searchNames("サンノミヤ")).toEqual(expect.arrayContaining(["三ノ宮", "三宮"]));
    expect(searchNames("osaka")[0]).toBe("大阪");
    expect(searchNames("kobe-sannomiya")[0]).toBe("神戸三宮");
  });

  it("空の入力では何も返さず、件数は上限で切る", () => {
    expect(searchNames("  ")).toEqual([]);
    expect(searchStationChoices(index, catalog, "駅", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("findNearestChoices", () => {
  it("近い順にまとめた駅と距離を返す", () => {
    const nearest = findNearestChoices(index, catalog, { lat: 34.6948, lon: 135.19504 });
    expect(nearest[0]?.station.name).toBe("三ノ宮");
    expect(nearest[0]?.meters).toBeLessThan(50);
    expect(nearest.length).toBe(3);
  });
});

describe("LocationRequestSchema", () => {
  it("日本の範囲外の座標を拒否する", () => {
    expect(LocationRequestSchema.safeParse({ lat: 34.7, lon: 135.5 }).success).toBe(true);
    expect(LocationRequestSchema.safeParse({ lat: 0, lon: 0 }).success).toBe(false);
    expect(LocationRequestSchema.safeParse({ lat: "34" }).success).toBe(false);
  });
});

describe("describeStationNames / describeStationLines", () => {
  it("駅名から英語名を引き、無い駅は null にする", () => {
    expect(describeStationNames(catalog, ["大阪", "存在しない駅"])).toEqual({
      大阪: "Osaka",
      存在しない駅: null,
    });
  });

  it("日本語は事業者と路線、英語は事業者名を並べる", () => {
    const umeda = catalog.groupById.get("大阪梅田")?.choice;
    if (!umeda) throw new Error("大阪梅田が無い");
    expect(describeStationLines(umeda, "ja")).toMatch(/阪急 .*神戸線/);
    expect(describeStationLines(umeda, "en")).toMatch(/Hankyu Kobe Line/);
  });
});

describe("formatDistance", () => {
  it("1km 未満は 50m 単位、以上は 0.1km 単位で表す", () => {
    expect(formatDistance(12)).toBe("50m");
    expect(formatDistance(320)).toBe("300m");
    expect(formatDistance(1530)).toBe("1.5km");
  });
});
