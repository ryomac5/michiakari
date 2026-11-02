import type { StationNode } from "@repo/geo";
import { describe, expect, it } from "vitest";
import { resolveLineColor, resolveLineType } from "../src/attributes.ts";
import { buildLineId, buildStationId, sanitizeIdPart } from "../src/ids.ts";
import { findTransfers, isRelatedStationName } from "../src/transfers.ts";

describe("ID", () => {
  it("URL で意味を持つ記号を除き、日本語は残す", () => {
    expect(sanitizeIdPart("三宮・花時計前")).toBe("三宮_花時計前");
    expect(buildLineId("osaka-metro", "御堂筋線")).toBe("osaka-metro.御堂筋線");
    expect(buildStationId("hankyu.神戸線", "岡本")).toBe("hankyu.神戸線.岡本");
  });
});

describe("路線の属性", () => {
  it("表にある路線は表の値、ない路線は事業者の既定値", () => {
    expect(resolveLineType("jr-west", "東海道線")).toBe("jr_rapid");
    expect(resolveLineType("jr-west", "桜島線")).toBe("jr_local");
    expect(resolveLineType("unknown", "何か線")).toBe("private_local");
    expect(resolveLineColor("osaka-metro", "御堂筋線")).toBe("#E5171F");
    expect(resolveLineColor("unknown", "何か線")).toBe("#7F7F7F");
  });
});

describe("乗換", () => {
  const node = (stationId: string, name: string, lon: number): StationNode => ({
    stationId,
    name,
    operator: "x",
    lineId: stationId.split(".")[0] ?? "",
    lonLat: [lon, 35],
    passengers: null,
  });

  it("名前の関連を判定する", () => {
    expect(isRelatedStationName("梅田", "大阪梅田")).toBe(true);
    expect(isRelatedStationName("三ノ宮", "神戸三宮")).toBe(true);
    expect(isRelatedStationName("梅田", "難波")).toBe(false);
  });

  it("300m以内の駅と、名前が関連する1km以内の駅を結ぶ", () => {
    // 経度0.001度 ≒ 91m
    const transfers = findTransfers([
      node("a.x.梅田", "梅田", 135),
      node("b.y.大阪梅田", "大阪梅田", 135.008),
      node("c.z.北新地", "北新地", 135.003),
      node("d.w.福島", "福島", 135.015),
    ]);
    expect(transfers.map((t) => `${t.from}~${t.to}`)).toEqual([
      "a.x.梅田~b.y.大阪梅田",
      "a.x.梅田~c.z.北新地",
    ]);
    expect(transfers[0]?.walkMeters).toBeGreaterThan(700);
  });
});
