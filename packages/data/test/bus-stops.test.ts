import { describe, expect, it } from "vitest";
import { normalizeBusOperatorName } from "../config/bus-operators.ts";
import {
  BUS_STOP_STATION_RADIUS_METERS,
  type BusStopRow,
  buildBusStopFeatures,
  excludeUnusableStops,
  filterNearStations,
} from "../src/bus-build.ts";

const row = (record: number, lon: number, lat: number): BusStopRow => ({
  dataset: "P11-22_27",
  record,
  name: `架空停留所${record}`,
  raw_operator: "阪急バス（株）",
  lon,
  lat,
});

describe("filterNearStations", () => {
  it("駅から半径の内側の停留所だけを残す", () => {
    const station = [135.5, 34.7] as const;
    // 緯度 0.001 度はおよそ 111m
    const near = row(1, 135.5, 34.701);
    const far = row(2, 135.5, 34.72);
    expect(filterNearStations([near, far], [station], BUS_STOP_STATION_RADIUS_METERS)).toEqual([
      near,
    ]);
  });

  it("半径は徒歩 10 分の概算で届く距離にそろえる", () => {
    expect(BUS_STOP_STATION_RADIUS_METERS).toBeGreaterThan(500);
    expect(BUS_STOP_STATION_RADIUS_METERS).toBeLessThan(800);
  });
});

describe("excludeUnusableStops", () => {
  it("名前に高速バスを含む停留所を外す", () => {
    const terminal = { ...row(3, 135.5, 34.7), name: "架空駅高速バスターミナル" };
    const city = row(4, 135.5, 34.7);
    expect(excludeUnusableStops([terminal, city])).toEqual([city]);
  });
});

describe("buildBusStopFeatures", () => {
  it("版とレコードで ID を作り、事業者名を付け替え、座標を丸める", () => {
    const [feature] = buildBusStopFeatures([row(12, 135.1234567, 34.7654321)]);
    expect(feature?.properties).toEqual({
      id: "P11-22_27:12",
      name: "架空停留所12",
      operator: "阪急バス",
    });
    expect(feature?.geometry.coordinates).toEqual([135.12346, 34.76543]);
  });
});

describe("normalizeBusOperatorName", () => {
  it("表の事業者は表示名に付け替える", () => {
    expect(normalizeBusOperatorName("京都市")).toBe("京都市バス");
    expect(normalizeBusOperatorName("近江鉄道（株）")).toBe("近江鉄道バス");
  });

  it("表にない事業者は会社の種類の表記だけを外す", () => {
    expect(normalizeBusOperatorName("（株）ウイング神姫")).toBe("ウイング神姫");
    expect(normalizeBusOperatorName("高槻市")).toBe("高槻市");
  });
});
