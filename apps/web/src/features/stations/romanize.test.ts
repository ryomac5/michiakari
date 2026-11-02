import { describe, expect, it } from "vitest";
import { romanizeStationName } from "./romanize";

describe("romanizeStationName", () => {
  it("長音を縮めたヘボン式にする", () => {
    expect(romanizeStationName("大阪", "おおさか")).toBe("Osaka");
    expect(romanizeStationName("京都", "きょうと")).toBe("Kyoto");
    expect(romanizeStationName("十三", "じゅうそう")).toBe("Juso");
    expect(romanizeStationName("三ノ宮", "さんのみや")).toBe("Sannomiya");
  });

  it("促音と、b・m・p の前の撥音を表す", () => {
    expect(romanizeStationName("北新地", "きたしんち")).toBe("Kita-Shinchi");
    expect(romanizeStationName("本町", "ほんまち")).toBe("Hommachi");
    expect(romanizeStationName("難波", "なんば")).toBe("Namba");
    expect(romanizeStationName("天王寺", "てんのうじ")).toBe("Tennoji");
    expect(romanizeStationName("吉野口", "よしのぐち")).toBe("Yoshinoguchi");
    expect(romanizeStationName("鳥取ノ荘", "とっとりのしょう")).toBe("Tottorinosho");
  });

  it("接頭語はハイフンで区切り、JR はそのまま残す", () => {
    expect(romanizeStationName("新大阪", "しんおおさか")).toBe("Shin-Osaka");
    expect(romanizeStationName("大阪梅田", "おおさかうめだ")).toBe("Osaka-Umeda");
    expect(romanizeStationName("神戸三宮", "こうべさんのみや")).toBe("Kobe-Sannomiya");
    expect(romanizeStationName("JR難波", "じぇいあーるなんば")).toBe("JR Namba");
    expect(romanizeStationName("大阪", "おおさか")).toBe("Osaka");
  });

  it("読みが無いか、変換できない文字を含むときは null", () => {
    expect(romanizeStationName("大阪港", undefined)).toBeNull();
    expect(romanizeStationName("大阪港", "おおさか港")).toBeNull();
  });
});
