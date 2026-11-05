import { describe, expect, it } from "vitest";
// 徒歩経路の出典は前処理（packages/data）の定数と同じ文言にする
import { WALK_ATTRIBUTION } from "../../../../packages/data/config/sources.ts";
import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import { resolveLocale, resolveTheme } from "./config";

function listKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => listKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe("メッセージファイル", () => {
  it("ja と en のキーが一致する", () => {
    expect(listKeys(en).sort()).toEqual(listKeys(ja).sort());
  });

  it("アプリ名と副題は決めた表記どおり", () => {
    expect([ja.app.name, ja.app.tagline]).toEqual(["マツカエル", "待つか、乗り換えるか。"]);
    expect([en.app.name, en.app.tagline]).toEqual(["MatsuKaeru", "Wait, or switch?"]);
  });

  it("結論の近くに出す注意書きは vision.md 8 章の文言を含む", () => {
    expect(ja.disclaimer.short).toContain("推定であり、公式発表を優先してください");
  });

  it("出典表示は data-sources.md 4 章の文言どおり", () => {
    expect(ja.about.attribution).toEqual({
      title: "出典",
      map: "地図: 国土地理院 / © OpenStreetMap contributors",
      walk: WALK_ATTRIBUTION,
      rail: "鉄道データ: 「国土数値情報（鉄道データ）」（国土交通省）を加工して作成",
      ridership: "駅の乗降客数: 「国土数値情報（駅別乗降客数データ）」（国土交通省）を加工して作成",
      weather: "気象データ: 気象庁",
    });
  });
});

describe("resolveLocale / resolveTheme", () => {
  it("未知の値は既定（日本語・ライト）に倒す", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("ja");
    expect(resolveLocale(undefined)).toBe("ja");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme(undefined)).toBe("light");
  });
});
