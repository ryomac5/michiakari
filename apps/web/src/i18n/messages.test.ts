import { describe, expect, it } from "vitest";
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

  it("出典表示は data-sources.md 4 章の文言どおり", () => {
    expect(ja.about.attribution).toEqual({
      title: "出典",
      map: "地図: 国土地理院 / © OpenStreetMap contributors",
      rail: "鉄道データ: 国土数値情報（鉄道データ）（国土交通省）を加工して作成",
      weather: "気象データ: 気象庁",
    });
  });
});

describe("resolveLocale / resolveTheme", () => {
  it("未知の値は既定（日本語・ダーク）に倒す", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("ja");
    expect(resolveLocale(undefined)).toBe("ja");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme(undefined)).toBe("dark");
  });
});
