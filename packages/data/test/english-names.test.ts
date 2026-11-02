import { describe, expect, it } from "vitest";
import { LINE_COLORS } from "../config/line-colors.ts";
import { LINE_NAMES_EN, OPERATOR_NAMES_EN } from "../config/line-names-en.ts";
import { OPERATORS } from "../config/operators.ts";
import { STATION_NAME_EN_OVERRIDES } from "../config/station-names-en.ts";
import { STATION_READINGS } from "../config/station-readings.ts";
import {
  resolveLineNameEn,
  resolveOperatorNameEn,
  resolveStationNameEn,
} from "../src/attributes.ts";
import { romanizeReading } from "../src/romanize.ts";

describe("romanizeReading", () => {
  it.each([
    ["おおさか", "Osaka"],
    ["きょうと", "Kyoto"],
    ["さんのみや", "Sannomiya"],
    ["うめだ", "Umeda"],
    ["なんば", "Namba"],
    ["てんのうじ", "Tennoji"],
    ["きょうばし", "Kyobashi"],
    ["じゅうそう", "Juso"],
    ["ほんまち", "Hommachi"],
    ["にっぽんばし", "Nippombashi"],
    ["ろっこう", "Rokko"],
    ["せんりちゅうおう", "Senrichuo"],
  ])("%s → %s", (reading, expected) => {
    expect(romanizeReading(reading)).toBe(expected);
  });

  it("表にない文字は例外", () => {
    expect(() => romanizeReading("ゐ")).toThrow();
  });
});

describe("駅の英語名", () => {
  it("読みのある駅は英語名を持ち、ない駅は持たない", () => {
    expect(resolveStationNameEn("天王寺")).toBe("Tennoji");
    expect(resolveStationNameEn("大阪梅田")).toBe("Osaka-umeda");
    expect(resolveStationNameEn("神戸三宮")).toBe("Kobe-sannomiya");
    expect(resolveStationNameEn("一乗寺")).toBeUndefined();
  });

  it("すべての読みをローマ字にできる", () => {
    for (const name of Object.keys(STATION_READINGS)) {
      expect(resolveStationNameEn(name), name).toMatch(/^[A-Z][\x20-\x7e]*$/);
    }
  });

  it("上書きの表は読みのある駅だけを書く", () => {
    const orphans = Object.keys(STATION_NAME_EN_OVERRIDES).filter((n) => !STATION_READINGS[n]);
    expect(orphans).toEqual([]);
  });
});

describe("路線と事業者の英語名", () => {
  it("表の値を引く", () => {
    expect(resolveLineNameEn("hankyu", "神戸線")).toBe("Hankyu Kobe Line");
    expect(resolveLineNameEn("keihan", "京阪本線")).toBe("Keihan Main Line");
    expect(resolveLineNameEn("unknown", "何か線")).toBeUndefined();
    expect(resolveOperatorNameEn("jr-west")).toBe("JR West");
  });

  it("正規化表のすべての事業者が英語名を持つ", () => {
    const missing = OPERATORS.filter((o) => !OPERATOR_NAMES_EN[o.key]).map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it("路線色の表にある路線はすべて英語名を持つ", () => {
    const missing = Object.keys(LINE_COLORS).filter((key) => !LINE_NAMES_EN[key]);
    expect(missing).toEqual([]);
  });
});
