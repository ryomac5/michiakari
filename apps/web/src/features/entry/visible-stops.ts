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
};

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
export function buildStopLabelRect(point: ScreenPoint, label: string, side: LabelSide): Rect {
  return placeBox(
    {
      key: label,
      point,
      gap: labelGap,
      size: { w: labelPadding + estimateTextWidth(label, 13, 7.5), h: labelHeight },
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
      expandRect(buildStopLabelRect(point, stop.label, side), margin);
    const side = sides.find((s) => taken.every((rect) => overlapArea(rectOf(s), rect) === 0));
    if (!side && !isDirection) return [];
    const chosen = side ?? stop.side;
    taken.push(rectOf(chosen), dot);
    return [{ ...stop, side: chosen }];
  });
}
