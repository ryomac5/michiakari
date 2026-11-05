import { describe, expect, it } from "vitest";
import { createGeoProvider, loadSharedGeoDeps } from "../src/alternatives/geo-provider.ts";
import { findLineNicknameEn } from "../src/alternatives/line-names-en.ts";
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

  it("出発地の近くのバス停を、同じ名前は 1 件にまとめて返し、高速バスは出さない", async () => {
    const checks = provider.listBusChecks(query.origin);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.length).toBeLessThanOrEqual(3);
    const minutes = checks.map((b) => b.walkMinutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(minutes.every((m) => m <= 10)).toBe(true);
    expect(checks.every((b) => b.dataYear === 2022 && b.operators.length > 0)).toBe(true);
    expect(checks.some((b) => b.stopName.includes("高速バス"))).toBe(false);
    expect(new Set(checks.map((b) => b.stopName)).size).toBe(checks.length);
    // 代替手段の算出にはバス停を混ぜない
    const result = await provider.findAlternatives(query);
    expect(JSON.stringify(result)).not.toContain(checks[0]?.stopName ?? "-");
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

  it("待つ選択肢のラベルと止まっている路線の区間は、観測の路線名を使う", async () => {
    const result = await provider.findAlternatives(query);
    const wait = result.options[0];
    expect(wait?.label).toBe("JR京都線の運転再開を待つ");
    const blockedLineId = wait?.legs[0]?.lineId;
    const blockedLegs = wait?.legs.filter((l) => l.lineId === blockedLineId) ?? [];
    expect(blockedLegs.length).toBeGreaterThan(0);
    expect(blockedLegs.every((l) => l.line === "JR京都線")).toBe(true);
  });

  it("英語では、日本語の観測の路線名を通称の英語名に直す", async () => {
    const result = await provider.findAlternatives({ ...query, language: "en" });
    const wait = result.options[0];
    expect(wait?.label).toBe("Wait for JR Kyoto Line to resume");
    expect(wait?.legs[0]?.line).toBe("JR Kyoto Line");
  });

  it("英語の観測の路線名はそのまま使う", async () => {
    const result = await provider.findAlternatives({
      ...query,
      blockedLine: "JR Kyoto Line",
      language: "en",
    });
    expect(result.options[0]?.label).toBe("Wait for JR Kyoto Line to resume");
  });

  it("観測の路線名が無ければ、路線データの名前を使う", async () => {
    const result = await provider.findAlternatives({ ...query, blockedLine: null });
    const wait = result.options[0];
    expect(wait?.kind).toBe("wait");
    expect(wait?.label).not.toContain("JR京都線");
    expect(wait?.label).toBe(`${wait?.legs[0]?.line}の運転再開を待つ`);
  });
});

describe("塚本から三ノ宮へ（JR神戸線の大阪〜三ノ宮が止まっている）", () => {
  // 塚本は別の鉄道の駅まで歩いて 20 分以上かかる。以前はタクシーしか代替に入らなかった
  const tsukamoto: AlternativesQuery = {
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "三ノ宮" },
    blockedLine: "JR神戸線",
    blockedSection: { fromStation: "大阪", toStation: "三ノ宮" },
    now: "2026-11-05T22:00:00+09:00",
    departureTime: "2026-11-05T22:13:00+09:00",
    remaining: { p50: 60, p80: 90 },
    transferServiceActive: null,
    language: "ja",
  };

  it("徒歩で別の鉄道の駅へ行く経路が入り、タクシーも運賃つきで残る", async () => {
    const result = await provider.findAlternatives(tsukamoto);
    const rails = result.options.filter((o) => o.kind === "transfer");
    expect(rails.length).toBeGreaterThan(0);
    const stations = rails.map((o) => o.legs[0]?.to);
    expect(stations.every((s) => ["御幣島", "姫島", "十三"].includes(s ?? ""))).toBe(true);
    for (const option of rails) {
      expect(option.legs[0]?.mode).toBe("walk");
      expect(option.walkMinutes).toBeGreaterThan(15);
      expect(option.legs.some((l) => l.mode === "ride")).toBe(true);
    }
    expect(result.options.find((o) => o.kind === "taxi")?.fareYen).toBeGreaterThan(0);
  });

  it("英語の利用者にも、同じ経路を英語の表示名で返す", async () => {
    const result = await provider.findAlternatives({ ...tsukamoto, language: "en" });
    const rails = result.options.filter((o) => o.kind === "transfer");
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((o) => !/[ぁ-んァ-ヶ一-龠]/.test(o.label))).toBe(true);
  });
});

describe("findLineNicknameEn", () => {
  it("JR の通称を英語名に直す", () => {
    expect(findLineNicknameEn("JR京都線")).toBe("JR Kyoto Line");
    expect(findLineNicknameEn("JR神戸線")).toBe("JR Kobe Line");
    expect(findLineNicknameEn("ＪＲ宝塚線")).toBe("JR Takarazuka Line");
  });

  it("事業者を省いた名前や表に無い名前は null", () => {
    expect(findLineNicknameEn("京都線")).toBeNull();
    expect(findLineNicknameEn("阪急京都線")).toBeNull();
  });
});
