import { describe, expect, it } from "vitest";
import { createGeoProvider, loadSharedGeoDeps } from "../src/alternatives/geo-provider.ts";
import type { AlternativesQuery } from "../src/alternatives/provider.ts";

// 国土数値情報の路線ネットワークによる代替手段の算出

const provider = createGeoProvider();

const query: AlternativesQuery = {
  origin: { kind: "station", name: "大阪" },
  destination: { kind: "station", name: "京都駅" },
  blockedLine: "JR京都線",
  blockedSection: { fromStation: "大阪", toStation: "京都" },
  now: "2026-11-05T22:10:00+09:00",
  remaining: { p50: 30, p80: 60 },
  transferServiceActive: true,
  language: "ja",
};

describe("createGeoProvider", () => {
  it("路線ネットワークは 1 回だけ読む", () => {
    expect(loadSharedGeoDeps()).toBe(loadSharedGeoDeps());
  });

  it("先頭に待つ選択肢を置き、止まっている区間を通らない経路を返す", async () => {
    const result = await provider.findAlternatives(query);
    const [wait, ...others] = result.options;
    expect(wait?.kind).toBe("wait");
    expect(wait?.legs[0]).toMatchObject({ mode: "wait", minutes: 30 });
    expect(result.waitRouteMinutesAfterResume).toBeGreaterThan(0);

    const transfers = others.filter((o) => o.kind === "transfer");
    expect(transfers.length).toBeGreaterThan(0);
    const blockedLineId = wait?.legs[0]?.lineId;
    expect(blockedLineId).toBeDefined();
    for (const option of transfers) {
      const rides = option.legs.filter((l) => l.mode === "ride");
      expect(rides.every((l) => l.lineId !== blockedLineId)).toBe(true);
      expect(option.isTransferService).toBe(true);
    }
    expect(others.some((o) => o.kind === "taxi" && o.fareYen !== null)).toBe(true);
  });

  it("経路の各区間に駅 ID と路線 ID を入れる", async () => {
    const result = await provider.findAlternatives(query);
    const legs = result.options.flatMap((o) => o.legs);
    expect(legs.every((l) => l.fromStationId && l.toStationId)).toBe(true);
    expect(legs.filter((l) => l.mode === "ride").every((l) => l.lineId)).toBe(true);
  });

  it("英語の利用者には表示名を付け直す", async () => {
    const result = await provider.findAlternatives({ ...query, language: "en" });
    expect(result.options.every((o) => !/[ぁ-ん]/.test(o.label))).toBe(true);
  });

  it("座標の地点は最寄り駅までの徒歩を足す", async () => {
    const result = await provider.findAlternatives({
      ...query,
      origin: { kind: "coord", lon: 135.4985, lat: 34.7045 },
    });
    const taxi = result.options.find((o) => o.kind === "taxi");
    expect(taxi?.legs[0]?.mode).toBe("walk");
  });

  it("見つからない駅なら待つ選択肢だけを返し、経路なしとする", async () => {
    const result = await provider.findAlternatives({
      ...query,
      origin: { kind: "station", name: "存在しない架空の駅名ですよ" },
    });
    expect(result.options.map((o) => o.kind)).toEqual(["wait"]);
    expect(result.waitRouteMinutesAfterResume).toBeNull();
  });

  it("文章から路線名を拾うための一覧に通称を含める", () => {
    const names = provider.listLines().map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(["JR京都線", "阪急神戸線"]));
  });
});
