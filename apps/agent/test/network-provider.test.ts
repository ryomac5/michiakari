import { describe, expect, it } from "vitest";
import { FIXTURE_NETWORK, type FixtureNetwork } from "../src/alternatives/fixture-network.ts";
import { createNetworkProvider } from "../src/alternatives/network-provider.ts";
import type { AlternativesQuery } from "../src/alternatives/provider.ts";

// 簡易プロバイダの振る舞い。テスト用の小さなネットワークで確かめる

const network: FixtureNetwork = {
  stations: [
    { name: "甲", lon: 135.5, lat: 34.7 },
    { name: "乙", lon: 135.6, lat: 34.7 },
    { name: "丙", lon: 135.5, lat: 34.705 },
    { name: "丁", lon: 135.6, lat: 34.705 },
  ],
  lines: [
    { name: "本線", operator: "架空鉄道", lineType: "jr_rapid", stations: ["甲", "乙"] },
    { name: "並行線", operator: "架空電鉄", lineType: "private_local", stations: ["丙", "丁"] },
  ],
};

const query: AlternativesQuery = {
  origin: { kind: "station", name: "甲駅" },
  destination: { kind: "station", name: "乙" },
  blockedLine: "本線",
  blockedSection: { fromStation: "甲", toStation: "乙" },
  now: "2026-11-05T12:00:00+09:00",
  remaining: { p50: 30, p80: 60 },
  transferServiceActive: true,
  language: "ja",
};

describe("createNetworkProvider", () => {
  it("先頭に待つ選択肢を置き、止まっている区間を使わない振替経路を返す", async () => {
    const result = await createNetworkProvider(network).findAlternatives(query);
    expect(result.options[0]?.kind).toBe("wait");
    expect(result.options[0]?.legs[0]).toMatchObject({ mode: "wait", minutes: 30 });
    const transfer = result.options.find((o) => o.kind === "transfer");
    expect(transfer?.legs.filter((l) => l.mode === "ride").map((l) => l.line)).toEqual(["並行線"]);
    expect(transfer?.isTransferService).toBe(true);
    expect(result.options.some((o) => o.kind === "taxi" && o.fareYen !== null)).toBe(true);
    expect(result.waitRouteMinutesAfterResume).toBeGreaterThan(0);
  });

  it("路線が分からなければ、出発地と目的地を直接結ぶ路線を止まっているとみなす", async () => {
    const result = await createNetworkProvider(network).findAlternatives({
      ...query,
      blockedLine: null,
    });
    const transfer = result.options.find((o) => o.kind === "transfer");
    expect(transfer?.legs.some((l) => l.line === "本線")).toBe(false);
  });

  it("ネットワークに無い駅なら待つ選択肢だけを返し、経路なしとする", async () => {
    const result = await createNetworkProvider(network).findAlternatives({
      ...query,
      origin: { kind: "station", name: "存在しない駅" },
    });
    expect(result.options.map((o) => o.kind)).toEqual(["wait"]);
    expect(result.waitRouteMinutesAfterResume).toBeNull();
  });

  it("開発用ネットワークの路線はすべて座標のある駅だけでできている", () => {
    const names = new Set(FIXTURE_NETWORK.stations.map((s) => s.name));
    for (const line of FIXTURE_NETWORK.lines) {
      for (const station of line.stations)
        expect(names.has(station), `${line.name}: ${station}`).toBe(true);
    }
  });
});
