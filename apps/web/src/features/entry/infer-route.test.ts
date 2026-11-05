import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import { createEntryData, findStationChoice, openStationChoice } from "./entry-places";
import { inferEntryRoutes, listTrainLines } from "./infer-route";

const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);
function infer(origin: string, destination: string) {
  const from = findStationChoice(data, origin);
  const to = findStationChoice(data, destination);
  const opened = from && openStationChoice(data, from);
  if (!opened || !to) throw new Error("テストの駅がありません");
  return inferEntryRoutes(data, opened.place, to);
}
describe("inferEntryRoutes", () => {
  it("共通路線が一つなら路線と行き先側の方面を返す", () => {
    const candidates = infer("大阪", "三ノ宮");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.line.observedName).toBe("JR神戸線");
    expect(candidates[0]?.direction.label.ja).toContain("三ノ宮");
    expect(infer("大阪", "京都")[0]?.line.observedName).toBe("JR京都線");
  });
  it("共通路線が複数なら全候補を残す", () => {
    const candidates = infer("大阪梅田", "十三");
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map((c) => c.line.lineId)).toEqual(
      expect.arrayContaining(["hankyu.京都線", "hankyu.神戸線", "hankyu.宝塚線"]),
    );
  });
  it("共通路線がなければ空配列を返して質問へ戻す", () => {
    expect(infer("心斎橋", "京都河原町")).toEqual([]);
  });
  it("同じ駅への方向は推定しない", () => {
    expect(infer("心斎橋", "心斎橋")).toEqual([]);
  });
});
describe("listTrainLines", () => {
  it("駅を先に選ばず全路線から選べ、通称の重複がない", () => {
    const lines = listTrainLines(data);
    expect(lines.find((l) => l.observedName === "JR神戸線")?.stationName).toBe("大阪");
    expect(new Set(lines.map((l) => `${l.lineId}|${l.observedName}`)).size).toBe(lines.length);
  });
});
