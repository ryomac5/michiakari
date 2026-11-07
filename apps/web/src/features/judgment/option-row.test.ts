import type { RouteLeg } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { listRideLines, selectOptionFacts } from "./option-row";

const same = (line: string) => line;

describe("listRideLines", () => {
  it("乗る路線の名前だけを乗る順に並べ、徒歩と待ちの区間と分数は入れない", () => {
    const legs: RouteLeg[] = [
      { mode: "walk", from: "現在地", to: "京橋", minutes: 4 },
      { mode: "ride", from: "京橋", to: "淀屋橋", minutes: 45, line: "京阪本線" },
      { mode: "walk", from: "淀屋橋", to: "梅田", minutes: 12 },
      { mode: "wait", from: "梅田", to: "梅田", minutes: 5 },
      { mode: "ride", from: "梅田", to: "三宮", minutes: 30, line: "阪急神戸線" },
    ];
    const lines = listRideLines(legs, same);
    expect(lines).toEqual(["京阪本線", "阪急神戸線"]);
    expect(lines.join(" → ")).not.toMatch(/徒歩|分|…/);
  });

  it("続けて同じ路線に乗るときは 1 つにし、路線名の無い区間は出さない", () => {
    const legs: RouteLeg[] = [
      { mode: "ride", from: "A", to: "B", minutes: 5, line: "JR京都線" },
      { mode: "ride", from: "B", to: "C", minutes: 5, line: "JR京都線" },
      { mode: "ride", from: "C", to: "D", minutes: 5 },
    ];
    expect(listRideLines(legs, same)).toEqual(["JR京都線"]);
  });

  it("タクシーには路線を出さない", () => {
    const legs: RouteLeg[] = [{ mode: "taxi", from: "大阪", to: "三ノ宮", minutes: 40 }];
    expect(listRideLines(legs, same)).toEqual([]);
  });

  it("訳した名前を使い、訳せない路線は出さない", () => {
    const legs: RouteLeg[] = [
      { mode: "ride", from: "A", to: "B", minutes: 5, line: "阪急京都線" },
      { mode: "ride", from: "B", to: "C", minutes: 5, line: "知らない線" },
    ];
    const translate = (line: string) => (line === "阪急京都線" ? "Hankyu Kyoto Line" : null);
    expect(listRideLines(legs, translate)).toEqual(["Hankyu Kyoto Line"]);
  });
});

describe("selectOptionFacts", () => {
  it("徒歩が 0 分なら徒歩を出さず、運賃が分からなければ運賃を出さない", () => {
    expect(selectOptionFacts({ walkMinutes: 0, fareYen: null })).toEqual({
      walkMinutes: null,
      fareYen: null,
      transferFare: null,
    });
    expect(selectOptionFacts({ walkMinutes: 0, fareYen: 4800 })).toEqual({
      walkMinutes: null,
      fareYen: 4800,
      transferFare: null,
    });
  });

  it("徒歩と運賃が分かれば両方を出す。運賃 0 円も出す", () => {
    expect(selectOptionFacts({ walkMinutes: 6, fareYen: 0 })).toEqual({
      walkMinutes: 6,
      fareYen: 0,
      transferFare: null,
    });
  });

  it("乗り換え先の追加の費用は、決まったときだけ出す", () => {
    expect(
      selectOptionFacts({ walkMinutes: 0, fareYen: null, transferFare: "fare_required" })
        .transferFare,
    ).toBe("fare_required");
    expect(
      selectOptionFacts({ walkMinutes: 0, fareYen: null, transferFare: "covered" }).transferFare,
    ).toBe("covered");
  });
});
