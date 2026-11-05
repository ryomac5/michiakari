import {
  type LayoutItem,
  overlapArea,
  placeBox,
  type Rect,
  type ScreenPoint,
} from "@/features/map/bubble-layout";
import type { LabelSide } from "./areas";
import type { EntryHub, Position } from "./entry-places";
import { pickLocalized } from "./entry-places";
import { estimateTextWidth } from "./visible-stations";

// 関西の段の大きな丸の札。画面の縁の札や互いの札と重ならない向きとずらしを選ぶ
// 中心の丸は必ず残し、収まらない丸は設定の後ろの丸から出さない

const labelGap = 14;
const dotRadius = 13;
const labelHeight = 27;
const labelPadding = 28;
const edgeHeight = 44;
// 矢印とその間隔、左右の余白
const edgePadding = 46;
// 札の幅の見積もりのずれを吸収する余白（px）
const margin = 4;
// 札を辺の方向へずらせる量の候補（px）
const slides = [0, -16, 16, -32, 32] as const;
const sideOrder: readonly LabelSide[] = ["right", "left", "top", "bottom"];

export type EdgeHub = { hub: EntryHub; x: number; y: number; angle: number };
export type HubLabel = { hub: EntryHub; side: LabelSide; slide: number };

function expandRect(rect: Rect, by: number): Rect {
  return {
    left: rect.left - by,
    right: rect.right + by,
    top: rect.top - by,
    bottom: rect.bottom + by,
  };
}

function containsRect(view: Rect, box: Rect): boolean {
  return (
    box.left >= view.left &&
    box.right <= view.right &&
    box.top >= view.top &&
    box.bottom <= view.bottom
  );
}

function measureEdgeWidth(hub: EntryHub, locale: string): number {
  return edgePadding + estimateTextWidth(pickLocalized(hub.label, locale), 14, 8.5);
}

// 縁の札が占める矩形。中心に置いた 44px の丸い札として見積もる
export function buildEdgeHubRect(edge: EdgeHub, locale: string): Rect {
  const width = measureEdgeWidth(edge.hub, locale);
  return {
    left: edge.x - width / 2,
    right: edge.x + width / 2,
    top: edge.y - edgeHeight / 2,
    bottom: edge.y + edgeHeight / 2,
  };
}

// 画面の外の丸を、画面の中心からその丸へ向かう線と、縁の矩形との交点に置く
// 同じ向きに重なった札は、先に置いた札から縁に沿ってずらす
export function placeEdgeHubs(
  hubs: readonly EntryHub[],
  project: (p: Position) => ScreenPoint,
  size: { width: number; height: number },
  insets: { top: number; bottom: number; left: number },
  locale: string,
): EdgeHub[] {
  const box = {
    left: insets.left + 16,
    right: size.width - 16,
    top: insets.top + 16,
    bottom: size.height - insets.bottom - 16,
  };
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const placed: { edge: EdgeHub; alongY: boolean }[] = [];
  for (const hub of hubs) {
    const p = project(hub.position);
    if (p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom) continue;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const halfWidth = measureEdgeWidth(hub, locale) / 2;
    const halfHeight = edgeHeight / 2;
    const sx =
      dx === 0 ? Infinity : ((dx > 0 ? box.right - halfWidth : box.left + halfWidth) - cx) / dx;
    const sy =
      dy === 0 ? Infinity : ((dy > 0 ? box.bottom - halfHeight : box.top + halfHeight) - cy) / dy;
    const scale = Math.min(sx, sy);
    const edge: EdgeHub = {
      hub,
      x: cx + dx * scale,
      y: cy + dy * scale,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
    // 左右の縁に着いた札は縦に、上下の縁に着いた札は横にずらす
    const alongY = sx <= sy;
    for (const other of placed) {
      const mine = expandRect(buildEdgeHubRect(edge, locale), margin);
      const theirs = buildEdgeHubRect(other.edge, locale);
      if (overlapArea(mine, theirs) === 0) continue;
      if (alongY) {
        const away = edge.y >= other.edge.y ? 1 : -1;
        const shift = away > 0 ? theirs.bottom - mine.top : theirs.top - mine.bottom;
        edge.y = Math.min(box.bottom - halfHeight, Math.max(box.top + halfHeight, edge.y + shift));
      } else {
        const away = edge.x >= other.edge.x ? 1 : -1;
        const shift = away > 0 ? theirs.right - mine.left : theirs.left - mine.right;
        edge.x = Math.min(box.right - halfWidth, Math.max(box.left + halfWidth, edge.x + shift));
      }
    }
    placed.push({ edge, alongY });
  }
  return placed.map(({ edge }) => edge);
}

function buildDotRect(point: ScreenPoint): Rect {
  return {
    left: point.x - dotRadius,
    right: point.x + dotRadius,
    top: point.y - dotRadius,
    bottom: point.y + dotRadius,
  };
}

type Candidate = { side: LabelSide; slide: number; box: Rect };

// 札の置き方の候補。設定の向きを先に、ずらさない置き方を先に並べる
function listCandidates(item: LayoutItem, preferred: LabelSide): Candidate[] {
  const sides = [preferred, ...sideOrder.filter((side) => side !== preferred)];
  return slides.flatMap((slide) =>
    sides.map((side) => ({
      side,
      slide,
      box: expandRect(placeBox(item, side, slide), margin),
    })),
  );
}

// 縁の札と互いの札や丸を避けて、地図の上に出す丸と札の置き方を選ぶ
// 中心の丸を先にまとめて置き、収まらなくても重なりの最も小さい置き方で残す
// 中心でない丸は、残った隙間に収まるものだけを出す
export function selectVisibleHubs(input: {
  hubs: readonly EntryHub[];
  edges: readonly Rect[];
  project: (position: Position) => ScreenPoint;
  view: Rect;
  locale: string;
  narrow: boolean;
}): HubLabel[] {
  const picked: { hub: EntryHub; side: LabelSide; slide: number; box: Rect; dot: Rect }[] = [];
  // 中心の丸の印は最初から避ける。札を先に置いた中心の丸が、後の中心の丸の印を隠さないようにする
  const coreDots = input.hubs
    .filter((hub) => hub.core)
    .map((hub) => ({ key: hub.areaId, rect: buildDotRect(input.project(hub.position)) }));
  const blockers = input.edges.map((edge) => expandRect(edge, margin));
  const measureOverlap = (rect: Rect, selfKey: string): number =>
    blockers.reduce((area, blocker) => area + overlapArea(rect, blocker), 0) +
    coreDots.reduce(
      (area, dot) => area + (dot.key === selfKey ? 0 : overlapArea(rect, dot.rect)),
      0,
    ) +
    picked.reduce(
      (area, other) =>
        area + overlapArea(rect, other.box) + (other.hub.core ? 0 : overlapArea(rect, other.dot)),
      0,
    );
  const place = (hub: EntryHub, required: boolean) => {
    const point = input.project(hub.position);
    const dot = buildDotRect(point);
    if (!required && measureOverlap(dot, hub.areaId) > 0) return;
    const item: LayoutItem = {
      key: hub.areaId,
      point,
      gap: labelGap,
      size: {
        w: labelPadding + estimateTextWidth(pickLocalized(hub.label, input.locale), 15, 9),
        h: labelHeight,
      },
    };
    const candidates = listCandidates(item, hub.side[input.narrow ? "narrow" : "wide"]);
    // まず画面の内側に収まる置き方、無ければ縁にかかっても重ならない置き方を選ぶ
    const overlapOf = (c: Candidate) => measureOverlap(c.box, hub.areaId);
    const fit =
      candidates.find((c) => containsRect(input.view, c.box) && overlapOf(c) === 0) ??
      candidates.find((c) => overlapOf(c) === 0);
    // 中心の丸は消さず、重なりの最も小さい置き方で残す
    const chosen =
      fit ??
      (required
        ? candidates.reduce((best, c) => (overlapOf(c) < overlapOf(best) ? c : best))
        : null);
    if (!chosen) return;
    picked.push({ hub, side: chosen.side, slide: chosen.slide, box: chosen.box, dot });
  };
  for (const hub of input.hubs) if (hub.core) place(hub, true);
  for (const hub of input.hubs) if (!hub.core) place(hub, false);
  return picked.map(({ hub, side, slide }) => ({ hub, side, slide }));
}
