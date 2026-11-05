import { describe, expect, it } from "vitest";
import {
  applyNetworkCorrections,
  buildNetworkGraph,
  createGeoIndex,
  listExtendedStationAliases,
} from "../src/index.ts";
import { loadNetworkData, loadRouter } from "../src/node.ts";

const raw = loadNetworkData();
const network = applyNetworkCorrections(raw);
const kyotoUmeda = "hankyu.京都線.大阪梅田";
const kobeUmeda = "hankyu.神戸線.大阪梅田";
const juso = "hankyu.京都線.十三";

describe("applyNetworkCorrections: 阪急京都線の大阪梅田発", () => {
  it("京都線の大阪梅田の駅を、神戸線の大阪梅田と同じ場所に足す", () => {
    const added = network.nodes.find((n) => n.stationId === kyotoUmeda);
    const source = raw.nodes.find((n) => n.stationId === kobeUmeda);
    expect(added).toMatchObject({ name: "大阪梅田", lineId: "hankyu.京都線" });
    expect(added?.lonLat).toEqual(source?.lonLat);
    expect(added?.nameEn).toBe(source?.nameEn);
  });

  it("京都線で大阪梅田から十三へ行ける。距離は神戸線の大阪梅田から十三までと同じ", () => {
    const graph = buildNetworkGraph(raw);
    const ride = graph
      .get(kyotoUmeda)
      ?.find((l) => l.kind === "ride" && l.to === juso && l.lineId === "hankyu.京都線");
    expect(ride).toBeDefined();
    const kobe = raw.edges.filter(
      (e) =>
        e.lineId === "hankyu.神戸線" &&
        [kobeUmeda, "hankyu.神戸線.中津", "hankyu.神戸線.十三"].includes(e.from) &&
        [kobeUmeda, "hankyu.神戸線.中津", "hankyu.神戸線.十三"].includes(e.to),
    );
    const km = kobe.reduce((sum, e) => sum + e.distanceKm, 0);
    expect(ride?.kind === "ride" ? ride.distanceKm : 0).toBeCloseTo(km, 2);
  });

  it("京都線の駅の並びは大阪梅田から始まり、累積距離はその分だけ延びる", () => {
    const line = network.lines.find((l) => l.lineId === "hankyu.京都線");
    const rawLine = raw.lines.find((l) => l.lineId === "hankyu.京都線");
    const segment = line?.segments.find((s) => s.stationIds[0] === kyotoUmeda);
    const rawSegment = rawLine?.segments.find((s) => s.stationIds[0] === juso);
    expect(segment?.stationIds.slice(0, 2)).toEqual([kyotoUmeda, juso]);
    expect(segment?.cumulativeKm[0]).toBe(0);
    const extra = segment?.cumulativeKm[1] ?? 0;
    expect(extra).toBeGreaterThan(2);
    expect(segment?.lengthKm).toBeCloseTo((rawSegment?.lengthKm ?? 0) + extra, 2);
  });

  it("神戸線の大阪梅田の乗換を写し、JR の大阪から歩いて乗れる", () => {
    const index = createGeoIndex(raw);
    const fromJr = index
      .listTransfers("jr-west.東海道線.大阪")
      .find((t) => t.station.stationId === kyotoUmeda);
    expect(fromJr?.walkMinutes).toBe(9);
    const sameStation = index.listTransfers(kobeUmeda).map((t) => t.station.stationId);
    expect(sameStation).toContain(kyotoUmeda);
  });

  it("大阪梅田から京都線で烏丸へ向かう経路を組める", () => {
    const router = loadRouter();
    const options = router.findAlternativeRoutes({
      originStationId: kyotoUmeda,
      destinationStationId: "hankyu.京都線.烏丸",
      blockedSection: null,
      departureTime: "2026-11-05T22:45:00+09:00",
      transferServiceActive: false,
    });
    const ride = options[0]?.legs.find((l) => l.mode === "ride");
    expect(ride).toMatchObject({ fromStationId: kyotoUmeda, lineId: "hankyu.京都線" });
  });

  it("元の網は書き換えず、同じ網に何度足しても 1 回分だけ", () => {
    expect(raw.nodes.some((n) => n.stationId === kyotoUmeda)).toBe(false);
    expect(applyNetworkCorrections(raw)).toBe(network);
    expect(applyNetworkCorrections(network)).toBe(network);
    expect(network.nodes.filter((n) => n.stationId === kyotoUmeda)).toHaveLength(1);
    expect(listExtendedStationAliases(raw)).toEqual([
      { stationId: kyotoUmeda, sourceStationId: kobeUmeda },
    ]);
  });
});
