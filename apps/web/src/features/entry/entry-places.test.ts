import type { NetworkData } from "@repo/geo";
import networkJson from "@repo/geo/data/network.json";
import { describe, expect, it } from "vitest";
import { createMapGeo } from "@/features/map/geo-data";
import { entryAreas } from "./areas";
import {
  createEntryData,
  findAreaAt,
  findStationChoice,
  listEntryHubs,
  openStationChoice,
  resolveConfiguredArea,
} from "./entry-places";

// 国土数値情報の実データ（packages/geo/data）で、手で整えた設定が駅データと噛み合うか確かめる
const geo = createMapGeo(networkJson as unknown as NetworkData);
const data = createEntryData(geo.nodes, geo.index);

describe("手で整えたエリア", () => {
  it("すべての丸と駅が駅データに見つかる", () => {
    expect(listEntryHubs(data).map((h) => h.areaId)).toEqual(entryAreas.map((a) => a.id));
    for (const config of entryAreas) {
      const area = resolveConfiguredArea(data, config.id);
      expect(
        area?.places.map((p) => p.key),
        config.id,
      ).toEqual(config.places.map((p) => p.key));
      for (const place of area?.places ?? []) {
        expect(place.lines.length, `${config.id}/${place.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("大阪駅の東海道線は JR神戸線と JR京都線に分けて出す", () => {
    const osaka = resolveConfiguredArea(data, "umeda")?.places.find((p) => p.key === "osaka");
    const names = osaka?.lines.map((l) => l.observedName);
    expect(names).toEqual(expect.arrayContaining(["JR神戸線", "JR京都線", "JR環状線"]));
    expect(osaka?.lines.every((l) => l.stationName === "大阪")).toBe(true);
  });

  it("三宮の丸は、選んだ路線ごとに出発の駅名が変わる", () => {
    const sannomiya = resolveConfiguredArea(data, "sannomiya")?.places[0];
    const byName = new Map(sannomiya?.lines.map((l) => [l.observedName, l.stationName]));
    expect(byName.get("JR神戸線")).toBe("三ノ宮");
    expect(byName.get("阪急神戸線")).toBe("神戸三宮");
  });
});

describe("findAreaAt", () => {
  it("丸の近くを触ると、手で整えたエリアに寄せる", () => {
    expect(findAreaAt(data, [135.5, 34.7])?.id).toBe("umeda");
    expect(findAreaAt(data, [135.505, 34.664])?.id).toBe("namba");
  });

  it("丸から離れた点では、近くの駅からエリアを作る", () => {
    const area = findAreaAt(data, [135.4983, 34.7616]);
    expect(area?.name).toBeNull();
    expect(area?.places.length).toBeGreaterThan(0);
    expect(area?.places.length).toBeLessThanOrEqual(6);
  });

  it("駅の少し外を触っても、指の幅の中の一番近い駅のまわりでエリアを作る", () => {
    // 八尾南の少し南。駅データから作るエリアの半径の外
    const point: [number, number] = [135.5849, 34.5851];
    expect(findAreaAt(data, point)).toBeNull();
    const area = findAreaAt(data, point, 4000);
    expect(area?.name).toBeNull();
    expect(area?.places.map((p) => p.name.ja)).toContain("八尾南");
  });

  it("駅の無い海の上では null を返す", () => {
    expect(findAreaAt(data, [135.2, 34.45])).toBeNull();
    expect(findAreaAt(data, [135.2, 34.45], 4000)).toBeNull();
  });

  it("引いた地図で海の上を押しても、指の幅が遠い駅まで届かない", () => {
    // 拡大率 7 の関西あたりでは、指の幅 44px が約 22km になる
    expect(findAreaAt(data, [135.2, 34.45], 22000)).toBeNull();
    expect(findAreaAt(data, [135.3, 34.55], 22000)).toBeNull();
  });
});

describe("openStationChoice", () => {
  it("手で整えたエリアの駅は、そのエリアの丸として開く", () => {
    const choice = findStationChoice(data, "神戸三宮");
    if (!choice) throw new Error("神戸三宮が無い");
    const opened = openStationChoice(data, choice);
    expect(opened?.area.id).toBe("sannomiya");
    expect(opened?.place.key).toBe("sannomiya");
  });

  it("ほかの駅は、まわりの駅と一緒に開く", () => {
    const choice = findStationChoice(data, "江坂");
    if (!choice) throw new Error("江坂が無い");
    const opened = openStationChoice(data, choice);
    expect(opened?.place.name.ja).toBe("江坂");
    expect(opened?.area.places.some((p) => p.key === opened.place.key)).toBe(true);
  });
});
