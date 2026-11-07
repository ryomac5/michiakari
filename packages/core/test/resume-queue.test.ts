import { describe, expect, it } from "vitest";
import { estimateQueueAfterResume } from "../src/index.ts";

describe("estimateQueueAfterResume", () => {
  it("規則 5: JR 西日本は間の駅と運転間隔から列の本数と 1 本 3〜5 分の待ちを出す", () => {
    const r = estimateQueueAfterResume({
      stationsBetween: 5,
      headwayMinutes: 5,
      operator: "JR西日本",
      cues: [],
    });
    expect(r).toEqual({
      closesUp: true,
      trainsInQueue: 3,
      waitRange: { minMinutes: 9, maxMinutes: 15 },
      queueAnnounced: false,
      worthAlightingAtNextStation: true,
    });
  });

  it("規則 5: 詰まりの放送があれば少なくとも 1 本とし、降りる価値ありとする", () => {
    const r = estimateQueueAfterResume({
      stationsBetween: 0,
      headwayMinutes: 10,
      operator: "jr-west",
      cues: ["queue_ahead"],
    });
    expect(r.trainsInQueue).toBe(1);
    expect(r.waitRange).toEqual({ minMinutes: 3, maxMinutes: 5 });
    expect(r.worthAlightingAtNextStation).toBe(true);
  });

  it("近くて列が短ければ降りる価値は無い", () => {
    const r = estimateQueueAfterResume({
      stationsBetween: 2,
      headwayMinutes: 5,
      operator: "jr-west",
      cues: [],
    });
    expect(r.trainsInQueue).toBe(1);
    expect(r.worthAlightingAtNextStation).toBe(false);
  });

  it("駅の数が分からなければ距離から駅の数に直す", () => {
    const r = estimateQueueAfterResume({
      stationsBetween: null,
      distanceKm: 7.5,
      headwayMinutes: 5,
      operator: "jr-west",
      cues: [],
    });
    expect(r.trainsInQueue).toBe(3);
  });

  it("詰めない事業者は待ちの範囲を出さない", () => {
    const r = estimateQueueAfterResume({
      stationsBetween: 5,
      headwayMinutes: 5,
      operator: "hankyu",
      cues: ["queue_ahead"],
    });
    expect(r).toMatchObject({
      closesUp: false,
      waitRange: null,
      worthAlightingAtNextStation: false,
    });
  });

  it("運転間隔が正でなければ投げる", () => {
    expect(() =>
      estimateQueueAfterResume({ stationsBetween: 1, headwayMinutes: 0, operator: null, cues: [] }),
    ).toThrow(RangeError);
  });
});
