import type { TimelineEntry } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  advanceReplayClock,
  computeEventGapMs,
  computeReplayProgress,
  eventGapMs,
  maxSpeed,
  resolveSpeedParam,
} from "./clock";

function buildEntry(id: string, offset: number): TimelineEntry {
  return { id, offset_minutes: offset, kind: "announcement", text: { ja: id } };
}

const timeline = [buildEntry("obs_1", 0), buildEntry("obs_2", 8), buildEntry("obs_3", 22)];

describe("advanceReplayClock", () => {
  it("1x では実時間 1 秒でシナリオの 1 分進む", () => {
    expect(advanceReplayClock(timeline, 1, 0, 1000, 1)).toEqual({
      kind: "advance",
      clockMinutes: 1,
    });
    expect(advanceReplayClock(timeline, 1, 2, 500, 4)).toEqual({
      kind: "advance",
      clockMinutes: 4,
    });
  });

  it("次の観測の時刻に届いたら、その時刻で止めて入力を指示する", () => {
    expect(advanceReplayClock(timeline, 1, 7.5, 1000, 2)).toEqual({
      kind: "input",
      clockMinutes: 8,
      index: 1,
    });
    expect(advanceReplayClock(timeline, 0, 0, 0, 1)).toEqual({
      kind: "input",
      clockMinutes: 0,
      index: 0,
    });
  });

  it("すべて入力し終えたら終わりを返す", () => {
    expect(advanceReplayClock(timeline, 3, 22, 1000, 1)).toEqual({
      kind: "end",
      clockMinutes: 22,
    });
  });
});

describe("resolveSpeedParam", () => {
  it("正の数だけを受け付け、上限で頭打ちにする", () => {
    expect(resolveSpeedParam("60")).toBe(60);
    expect(resolveSpeedParam("0.5")).toBe(0.5);
    expect(resolveSpeedParam("100000")).toBe(maxSpeed);
    expect(resolveSpeedParam("0")).toBeNull();
    expect(resolveSpeedParam("-2")).toBeNull();
    expect(resolveSpeedParam("abc")).toBeNull();
    expect(resolveSpeedParam(null)).toBeNull();
  });
});

describe("computeReplayProgress", () => {
  it("最後の観測の時刻を 1 とする", () => {
    expect(computeReplayProgress(timeline, 11)).toBe(0.5);
    expect(computeReplayProgress(timeline, 30)).toBe(1);
    expect(computeReplayProgress([], 0)).toBe(0);
  });
});

describe("computeEventGapMs", () => {
  it("速い再生では推論の間を空けない", () => {
    expect(computeEventGapMs(1)).toBe(eventGapMs);
    expect(computeEventGapMs(4)).toBe(eventGapMs);
    expect(computeEventGapMs(60)).toBe(0);
  });
});
