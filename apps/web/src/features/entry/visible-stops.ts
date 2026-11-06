import { overlapArea, placeBox, type Rect, type ScreenPoint } from "@/features/map/bubble-layout";
import type { LabelSide } from "./areas";
import type { Position } from "./entry-places";
import { estimateTextWidth } from "./visible-stations";

// 方面・行き先・近い駅の札を、画面の上で互いに重ならないように置く
// 候補は優先順に並んでいる。先の札と重なるなら丸の別の側へ回し、どの側にも収まらない後の札は落とす
// 方面の札は 2 つしか無いので落とさない

export type StopLabel = {
  key: string;
  position: Position;
  label: string;
  side: LabelSide;
  angle: number | null;
  // 路線の札は文字が大きく、路線色の印のぶん幅が広い
  kind?: "line";
};

// 路線の札の路線色の印と隙間の幅（px）
const lineSwatchWidth = 12;
// 路線の札は文字が大きいぶん背が高い（px）
const lineLabelHeight = 29;

const labelGap = 14;
const labelHeight = 25;
const labelPadding = 20;
const stopDotRadius = 7;
const directionDotRadius = 14;
// 札の幅の見積もりのずれを吸収する余白（px）
const margin = 4;
const sideOrder: readonly LabelSide[] = ["top", "right", "bottom", "left"];

function expandRect(rect: Rect, by: number): Rect {
  return {
    left: rect.left - by,
    right: rect.right + by,
    top: rect.top - by,
    bottom: rect.bottom + by,
  };
}

function buildDotRect(point: ScreenPoint, radius: number): Rect {
  return {
    left: point.x - radius,
    right: point.x + radius,
    top: point.y - radius,
    bottom: point.y + radius,
  };
}

// 駅の札の矩形。名前の文字幅から見積もる
export function buildStopLabelRect(
  point: ScreenPoint,
  label: string,
  side: LabelSide,
  line = false,
): Rect {
  const text = line
    ? lineSwatchWidth + estimateTextWidth(label, 14, 8)
    : estimateTextWidth(label, 13, 7.5);
  return placeBox(
    {
      key: label,
      point,
      gap: labelGap,
      size: { w: labelPadding + text, h: line ? lineLabelHeight : labelHeight },
    },
    side,
  );
}

export function selectVisibleStops<T extends StopLabel>(input: {
  stops: readonly T[];
  project: (position: Position) => ScreenPoint;
  // 先に置いてある札。選んだ駅の名前など
  blockers: readonly Rect[];
}): T[] {
  const taken: Rect[] = [...input.blockers];
  return input.stops.flatMap((stop) => {
    const point = input.project(stop.position);
    const isDirection = stop.angle !== null;
    const dot = buildDotRect(point, isDirection ? directionDotRadius : stopDotRadius);
    const sides = [stop.side, ...sideOrder.filter((side) => side !== stop.side)];
    const rectOf = (side: LabelSide) =>
      expandRect(buildStopLabelRect(point, stop.label, side, stop.kind === "line"), margin);
    const side = sides.find((s) => taken.every((rect) => overlapArea(rectOf(s), rect) === 0));
    if (!side && !isDirection) return [];
    const chosen = side ?? stop.side;
    taken.push(rectOf(chosen), dot);
    return [{ ...stop, side: chosen }];
  });
}

// 札の押せる丸の半径（px）。隣の印との中ほどまでにし、押せる範囲がぶつからないようにする
export function computeStopHitRadii(
  points: readonly ScreenPoint[],
  others: readonly ScreenPoint[] = [],
  max = 24,
  min = 8,
): number[] {
  return points.map((point, i) => {
    const near = [...points.filter((_, j) => j !== i), ...others].map((p) =>
      Math.hypot(p.x - point.x, p.y - point.y),
    );
    return Math.max(
      min,
      Math.min(max, Math.floor(Math.min(Number.POSITIVE_INFINITY, ...near) / 2)),
    );
  });
}

// キー・配置・札の文字が前と同じなら前の配列を返し、印を作り直さない
export function keepStopsIfSame<T extends StopLabel>(prev: T[], next: T[]): T[] {
  const same =
    prev.length === next.length &&
    prev.every((s, i) => {
      const n = next[i];
      return n !== undefined && s.key === n.key && s.side === n.side && s.label === n.label;
    });
  return same ? prev : next;
}
