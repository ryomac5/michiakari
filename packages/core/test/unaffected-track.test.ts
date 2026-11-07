import { describe, expect, it } from "vitest";
import { estimateUnaffectedTrackResume } from "../src/index.ts";

const affected = { p50: 80, p80: 110 };

describe("estimateUnaffectedTrackResume", () => {
  it("規則 3: 反対の線路なら 10〜15 分で動き出す見込み", () => {
    expect(
      estimateUnaffectedTrackResume({
        protection: true,
        trackSide: "opposite",
        affectedUntilResume: affected,
        elapsedSinceOnsetMinutes: 0,
      }),
    ).toEqual({ trackSide: "opposite", affected: null, opposite: { p50: 10, p80: 15 } });
  });

  it("規則 3: どちら側か分からなければ両方を並べる", () => {
    expect(
      estimateUnaffectedTrackResume({
        protection: true,
        trackSide: "unknown",
        affectedUntilResume: affected,
        elapsedSinceOnsetMinutes: 12,
      }),
    ).toEqual({ trackSide: "unknown", affected, opposite: { p50: 0, p80: 3 } });
  });

  it("当該の線路なら当該の見込みだけ", () => {
    expect(
      estimateUnaffectedTrackResume({
        protection: true,
        trackSide: "affected",
        affectedUntilResume: affected,
        elapsedSinceOnsetMinutes: 0,
      }),
    ).toEqual({ trackSide: "affected", affected, opposite: null });
  });

  it("防護無線の事象でなければ null", () => {
    expect(
      estimateUnaffectedTrackResume({
        protection: false,
        trackSide: "opposite",
        affectedUntilResume: affected,
        elapsedSinceOnsetMinutes: 0,
      }),
    ).toBeNull();
  });
});
