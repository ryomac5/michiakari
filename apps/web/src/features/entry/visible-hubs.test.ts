import { describe, expect, it } from "vitest";
import { overlapArea, placeBox, type Rect } from "@/features/map/bubble-layout";
import type { EntryHub } from "./entry-places";
import { buildEdgeHubRect, placeEdgeHubs, selectVisibleHubs } from "./visible-hubs";

// 関西の段で、縁の札と丸の札が重ならない置き方を選び、中心の丸を残して収まらない丸を出さないか確かめる

const view: Rect = { left: 8, top: 88, right: 367, bottom: 560 };
const project = ([x, y]: [number, number]) => ({ x, y });
function buildHub(areaId: string, ja: string, x: number, y: number, core = true): EntryHub {
  return {
    areaId,
    stationName: ja,
    label: { ja, en: areaId },
    position: [x, y],
    side: { wide: "left", narrow: "left" },
    core,
  };
}
function boxOf(hub: EntryHub, side: "left" | "right" | "top" | "bottom", slide = 0): Rect {
  const [x, y] = hub.position;
  const w = 28 + [...hub.label.ja].length * 15;
  return placeBox({ key: hub.areaId, point: { x, y }, gap: 14, size: { w, h: 27 } }, side, slide);
}
function dotOf(hub: EntryHub): Rect {
  const [x, y] = hub.position;
  return { left: x - 13, right: x + 13, top: y - 13, bottom: y + 13 };
}
const select = (hubs: EntryHub[], edges: Rect[] = []) =>
  selectVisibleHubs({ hubs, edges, project, view, locale: "ja", narrow: true });

describe("selectVisibleHubs", () => {
  // 375×667 の関西の段。左の縁の三ノ宮の札が、左向きの新大阪と難波の札に挟まれて重なっていた
  const shinOsaka = buildHub("shin-osaka", "新大阪", 150, 220);
  const namba = buildHub("namba", "難波", 150, 280);
  const edge = buildEdgeHubRect(
    { hub: buildHub("sannomiya", "三ノ宮", -200, 250, false), x: 72, y: 250, angle: 180 },
    "ja",
  );

  it("設定の向きのままでは縁の札に重なる", () => {
    expect(overlapArea(boxOf(shinOsaka, "left"), edge)).toBeGreaterThan(0);
    expect(overlapArea(boxOf(namba, "left"), edge)).toBeGreaterThan(0);
  });

  it("縁の札を避ける向きに変え、互いにも重ねない", () => {
    const labels = select([shinOsaka, namba], [edge]);
    expect(labels.map((l) => l.hub.areaId)).toEqual(["shin-osaka", "namba"]);
    const boxes = labels.map((l) => boxOf(l.hub, l.side, l.slide));
    for (const box of boxes) expect(overlapArea(box, edge)).toBe(0);
    expect(overlapArea(boxes[0] as Rect, boxes[1] as Rect)).toBe(0);
  });

  it("設定の向きで収まるなら向きを変えず、ずらさない", () => {
    const [label] = select([shinOsaka]);
    expect(label?.side).toBe("left");
    expect(label?.slide).toBe(0);
  });

  it("中心の丸どうしが近くても、どちらも消さずにずらして置く", () => {
    // 縦に 30px しか離れていない 2 つの中心の丸。向きを変えるだけでは札が印に重なる
    const osaka = buildHub("umeda", "大阪", 150, 250);
    const namba = buildHub("namba", "難波", 150, 280);
    const labels = select([osaka, namba]);
    expect(labels.map((l) => l.hub.areaId)).toEqual(["umeda", "namba"]);
    const boxes = labels.map((l) => boxOf(l.hub, l.side, l.slide));
    expect(overlapArea(boxes[0] as Rect, boxes[1] as Rect)).toBe(0);
    expect(overlapArea(boxes[0] as Rect, dotOf(namba))).toBe(0);
    expect(overlapArea(boxes[1] as Rect, dotOf(osaka))).toBe(0);
  });

  it("中心の丸は縁の札に挟まれても消えない", () => {
    const osaka = buildHub("umeda", "大阪", 72, 250);
    const around: Rect[] = [
      { left: 0, right: 200, top: 150, bottom: 230 },
      { left: 0, right: 200, top: 270, bottom: 350 },
      { left: 100, right: 200, top: 230, bottom: 270 },
    ];
    expect(select([osaka], around).map((l) => l.hub.areaId)).toEqual(["umeda"]);
  });

  it("どの向きにも置けない中心でない丸は出さない", () => {
    const osaka = buildHub("umeda", "大阪", 150, 250);
    const kyoto = buildHub("kyoto", "京都", 158, 254, false);
    expect(select([kyoto, osaka]).map((l) => l.hub.areaId)).toEqual(["umeda"]);
  });
});

describe("placeEdgeHubs", () => {
  const size = { width: 375, height: 667 };
  const insets = { top: 72, bottom: 100, left: 0 };

  it("画面の外の丸だけを、中心から向かう縁に置く", () => {
    const inside = buildHub("umeda", "大阪", 180, 300);
    const west = buildHub("sannomiya", "三ノ宮", -400, 300, false);
    const edges = placeEdgeHubs([inside, west], project, size, insets, "ja");
    expect(edges.map((e) => e.hub.areaId)).toEqual(["sannomiya"]);
    expect(edges[0]?.x).toBeCloseTo(60);
    expect(Math.abs(edges[0]?.angle ?? 0)).toBeGreaterThan(170);
  });

  it("同じ向きにある縁の札どうしは、縁に沿ってずらして重ねない", () => {
    const kyoto = buildHub("kyoto", "京都", 600, -300, false);
    const nara = buildHub("nara", "奈良", 620, -280, false);
    const edges = placeEdgeHubs([kyoto, nara], project, size, insets, "ja");
    expect(edges).toHaveLength(2);
    const rects = edges.map((e) => buildEdgeHubRect(e, "ja"));
    expect(overlapArea(rects[0] as Rect, rects[1] as Rect)).toBe(0);
    // 縁の中には収まったまま
    for (const rect of rects) {
      expect(rect.top).toBeGreaterThanOrEqual(insets.top + 16);
      expect(rect.right).toBeLessThanOrEqual(size.width - 16);
    }
  });
});
