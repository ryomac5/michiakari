import type { Judgment } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { selectTimeLine } from "./time-line";

// 閉じたシートの時刻の 1 行は、判断の結果の時刻をそのまま使う

const base: Judgment = {
  action: "switch",
  headline: "阪急神戸線に乗り換える",
  breakEven: null,
  estimate: {
    eventType: null,
    phaseId: null,
    elapsedMinutes: null,
    remaining: null,
    confidence: "low",
  },
  options: [
    {
      id: "hankyu",
      kind: "transfer",
      label: "阪急神戸線",
      legs: [],
      arrivalTime: "2026-11-07T20:40:00+09:00",
      fareYen: 330,
      walkMinutes: 8,
      isTransferService: true,
    },
  ],
  recommendedOptionId: "hankyu",
  evidence: [],
  disclaimer: "推定です",
};

describe("時刻の 1 行", () => {
  it("駅にいる人は、勧める選択肢で行き先に着く見込みの時刻にする", () => {
    expect(selectTimeLine(base, { kind: "station", name: "三ノ宮" })).toEqual({
      kind: "arrive",
      station: "三ノ宮",
      time: "2026-11-07T20:40:00+09:00",
    });
  });

  it("行き先が駅でなければ、駅名を付けない", () => {
    expect(selectTimeLine(base, { kind: "coord", lon: 135.2, lat: 34.7 })?.station).toBeNull();
  });

  const inCar: Judgment = {
    ...base,
    action: "wait",
    options: [],
    recommendedOptionId: null,
    inCar: {
      alightStation: "大阪",
      alightArrival: "2026-11-07T20:02:00+09:00",
      departure: "2026-11-07T19:58:00+09:00",
      afterAlight: null,
    },
  };

  it("駅間の車内で次の駅で降りるときは、その駅に着く見込みの時刻にする", () => {
    expect(selectTimeLine(inCar, { kind: "station", name: "大阪" })).toEqual({
      kind: "arrive",
      station: "大阪",
      time: "2026-11-07T20:02:00+09:00",
    });
  });

  it("駅間の車内で乗り続けるときは、次の駅の名前を出さず、自分の列車が動く時刻にする", () => {
    expect(selectTimeLine(inCar, { kind: "station", name: "京都" })).toEqual({
      kind: "depart",
      station: null,
      time: "2026-11-07T19:58:00+09:00",
    });
  });

  it("着く見込みが無ければ出さない", () => {
    expect(
      selectTimeLine({ ...base, recommendedOptionId: null }, { kind: "station", name: "三ノ宮" }),
    ).toBeNull();
  });
});
