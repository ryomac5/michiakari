import type { StationNode } from "@repo/geo";
import { describe, expect, it } from "vitest";
import { stepSectionPick } from "@/features/situation/use-section-pick";
import { listPickStations, selectPickBounds } from "./section-pick";

function buildNode(stationId: string, name: string, lineId: string, lon: number): StationNode {
  return { stationId, name, operator: "JR西日本", lineId, lonLat: [lon, 34.7], passengers: null };
}

const nodes = [
  buildNode("a", "大阪", "kobe", 135.5),
  buildNode("b", "塚本", "kobe", 135.47),
  buildNode("c", "三ノ宮", "kobe", 135.19),
  buildNode("d", "大阪", "loop", 135.5),
  buildNode("e", "大阪", "kobe", 135.5001),
];

describe("listPickStations", () => {
  it("その路線の駅だけを、同じ名前を 1 つにして並べる", () => {
    expect(listPickStations(nodes, "kobe").map((s) => s.name)).toEqual(["大阪", "塚本", "三ノ宮"]);
  });
});

describe("selectPickBounds", () => {
  it("現在地から半径の中の駅を収め、遠い駅は入れない", () => {
    const bounds = selectPickBounds(listPickStations(nodes, "kobe"), [135.5, 34.7], 8_000);
    expect(bounds?.[0][0]).toBeCloseTo(135.47, 2);
  });
});

describe("stepSectionPick", () => {
  it("1 つ目の駅を覚え、2 つ目の駅で区間を決める。同じ駅を押すと選び直す", () => {
    const first = stepSectionPick({ first: null }, "大阪");
    expect(first).toEqual({ pick: { first: "大阪" }, section: null });
    expect(stepSectionPick({ first: "大阪" }, "大阪")).toEqual({
      pick: { first: null },
      section: null,
    });
    expect(stepSectionPick({ first: "大阪" }, "尼崎")).toEqual({
      pick: null,
      section: { fromStation: "大阪", toStation: "尼崎" },
    });
  });
});
