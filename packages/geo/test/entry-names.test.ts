import { describe, expect, it } from "vitest";
import networkJson from "../data/network.json";
import { applyNetworkCorrections } from "../src/corrections.ts";
import type { NetworkData } from "../src/types.ts";

const source = networkJson as unknown as NetworkData;

describe("入口の英語名", () => {
  it("生成済みの網を書き換えず、京都と神戸の駅名を補う", () => {
    const before = source.nodes.find((node) => node.name === "東寺");
    const originalName = before?.nameEn;
    const network = applyNetworkCorrections(source);
    expect(network.nodes.find((node) => node.name === "東寺")?.nameEn).toBe("Toji");
    expect(network.nodes.find((node) => node.name === "三宮・花時計前")?.nameEn).toBe(
      "Sannomiya-Hanadokeimae",
    );
    expect(before?.nameEn).toBe(originalName);
    expect(network.lines).toHaveLength(source.lines.length);
  });
  it("京都と神戸の入口で使う路線が英語名を持つ", () => {
    for (const lineId of [
      "kintetsu.京都線",
      "keihan.京阪本線",
      "kyoto-subway.烏丸線",
      "hanshin.本線",
      "kobe-subway.山手線",
      "kobe-new-transit.ポートアイランド線",
    ]) {
      expect(
        applyNetworkCorrections(source).lines.find((line) => line.lineId === lineId)?.nameEn,
        lineId,
      ).toMatch(/[A-Za-z]/);
    }
  });
});
