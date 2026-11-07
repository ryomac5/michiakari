import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import { findGroupDirection, groupDirectionCandidates, groupLineStops } from "./direction-groups";
import { listEntryDirections } from "./directions";
import { createEntryData, type EntryLine, listGroupLines } from "./entry-places";
import { selectStopDirection } from "./map-pick";

// 実データで、行き先の候補が方面ごとに分かれるかを確かめる
const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);

function findLine(stationName: string, observedName: string): EntryLine {
  const group = data.catalog.groupById.get(stationName);
  const line = group
    ? listGroupLines(data, group).find((l) => l.observedName === observedName)
    : null;
  if (!line) throw new Error(`${stationName} の ${observedName} が見つかりません`);
  return line;
}

const names = (stops: { choice: { name: string } }[]) => stops.map((s) => s.choice.name);

describe("groupLineStops", () => {
  const directions = listEntryDirections(data, findLine("大阪", "JR環状線"));
  const groups = groupLineStops(directions);

  it("環状線の駅を 2 つの方面に分け、近い順に並べる", () => {
    expect(groups).toHaveLength(2);
    const east = groups.find((g) => names(g.stops).includes("天満"));
    const west = groups.find((g) => names(g.stops).includes("福島"));
    expect(names(east?.stops ?? []).slice(0, 3)).toEqual(["天満", "桜ノ宮", "京橋"]);
    expect(names(west?.stops ?? []).slice(0, 3)).toEqual(["福島", "野田", "西九条"]);
  });

  it("同じ駅を 2 つの方面に重ねて置かない", () => {
    const all = groups.flatMap((g) => names(g.stops));
    expect(new Set(all).size).toBe(all.length);
  });

  it("まとまりの方面は、駅の数の少ない向きの方面と同じになる", () => {
    for (const group of groups) {
      for (const stop of group.stops) {
        expect(findGroupDirection(groups, stop.choice.id)?.key).toBe(
          selectStopDirection(directions, stop.choice.id)?.key,
        );
      }
    }
  });
});

describe("groupDirectionCandidates", () => {
  it("JR神戸線の塚本では、三ノ宮の側と大阪の側の候補を混ぜない", () => {
    const groups = groupDirectionCandidates(
      listEntryDirections(data, findLine("塚本", "JR神戸線")),
    );
    const west = groups.find((g) => names(g.stops).includes("三ノ宮"));
    const east = groups.find((g) => names(g.stops).includes("大阪"));
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west).not.toBe(east);
    expect(names(west?.stops ?? [])).not.toContain("京都");
  });
});
