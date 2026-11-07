import type { RouteLeg, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { rankAlternativesForProtection } from "../src/index.ts";

type Option = Pick<RouteOption, "id" | "kind" | "legs">;

function ride(lineId: string): RouteLeg {
  return { mode: "ride", from: "A", to: "B", minutes: 10, lineId };
}

const options: Option[] = [
  { id: "wait", kind: "wait", legs: [ride("jr-west.東海道線")] },
  { id: "same", kind: "transfer", legs: [ride("jr-west.福知山線")] },
  { id: "taxi", kind: "taxi", legs: [{ mode: "taxi", from: "A", to: "B", minutes: 20 }] },
  { id: "other", kind: "transfer", legs: [ride("hankyu.神戸線")] },
];

describe("rankAlternativesForProtection", () => {
  it("規則 4: 並ぶ他社の線を上げ、同じ会社の線を下げる", () => {
    const ranked = rankAlternativesForProtection({
      options,
      protection: true,
      blockedLineId: "jr-west.東海道線",
    });
    expect(ranked.map((r) => [r.option.id, r.standing])).toEqual([
      ["other", "raised"],
      ["wait", "neutral"],
      ["taxi", "neutral"],
      ["same", "lowered"],
    ]);
  });

  it("路線 ID が無ければ事業者名で比べる", () => {
    const ranked = rankAlternativesForProtection({
      options,
      protection: true,
      blockedLineId: null,
      blockedOperator: "JR西日本",
    });
    expect(ranked[0]?.option.id).toBe("other");
  });

  it("防護無線の事象でなければ並びを変えない", () => {
    const ranked = rankAlternativesForProtection({
      options,
      protection: false,
      blockedLineId: "jr-west.東海道線",
    });
    expect(ranked.map((r) => r.option.id)).toEqual(["wait", "same", "taxi", "other"]);
    expect(ranked.every((r) => r.standing === "neutral")).toBe(true);
  });
});
