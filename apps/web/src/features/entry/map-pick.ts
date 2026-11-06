import type { ScreenPoint } from "@/features/map/bubble-layout";
import { sliceTrackBetween, type TrackParts } from "@/features/map/track-shape";
import type { LabelSide } from "./areas";
import type { DirectionStop, EntryDirection } from "./directions";
import type { EntryLine, Position } from "./entry-places";
import type { GpsChoice } from "./gps-candidates";
import { STATION_LABEL_MIN_ZOOM } from "./visible-stations";

// 入口の地図で、路線・方面・行き先・駅の間を押して選ぶための純粋な計算

// 路線の札。駅から路線の最初の方面へ少し進んだ線の上に置く
export type LinePick = { line: EntryLine; position: Position };

// 路線の札を置く点の、隣の駅までの割合
const lineLabelRatio = 0.75;
// 方面を選んだあとに地図へ名前を出す、方面の先の駅の数
export const ROUTE_STOP_LIMIT = 6;
// 車内の駅の間を地図で選ぶとき、選んでいる駅の間の前後に出す駅の間の数
const segmentWindow = 3;
// 駅の間の丸と、駅の印の丸の半径（px）
const segmentDotRadius = 8;
const stationDotRadius = 8;

// 緯度経度の差を、その場所の m に直す
function toMeters(from: Position, to: Position): { x: number; y: number } {
  const metersPerDegree = 111_320;
  return {
    x: (to[0] - from[0]) * metersPerDegree * Math.cos((from[1] * Math.PI) / 180),
    y: (to[1] - from[1]) * metersPerDegree,
  };
}

// 点から線分までの距離（m）
export function measureSegmentDistance(point: Position, a: Position, b: Position): number {
  const ab = toMeters(a, b);
  const ap = toMeters(a, point);
  const length = ab.x * ab.x + ab.y * ab.y;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / length));
  const dx = ap.x - ab.x * t;
  const dy = ap.y - ab.y * t;
  return Math.hypot(dx, dy);
}

// 点から折れ線までの距離（m）。点が 1 つだけなら、その点までの距離
export function measurePathDistance(point: Position, path: readonly Position[]): number {
  const [first] = path;
  if (!first) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return measureSegmentDistance(point, first, first);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a && b) best = Math.min(best, measureSegmentDistance(point, a, b));
  }
  return best;
}

// 駅の路線ごとに札の位置を決める。最初の方面の隣の駅との中ほどに置く
// 同じ位置になる路線は、次の方面の側へ回して重ならないようにする
export function listLinePicks(
  lines: readonly EntryLine[],
  origin: Position,
  directionsOf: (line: EntryLine) => readonly EntryDirection[],
): LinePick[] {
  const picks: LinePick[] = [];
  for (const line of lines) {
    const used = new Set(picks.map((p) => p.position.join(",")));
    const points = directionsOf(line).flatMap((d) => {
      const next = d.stops[0];
      if (!next) return [];
      const position: Position = [
        origin[0] + (next.position[0] - origin[0]) * lineLabelRatio,
        origin[1] + (next.position[1] - origin[1]) * lineLabelRatio,
      ];
      return [position];
    });
    const position = points.find((p) => !used.has(p.join(","))) ?? points[0];
    if (position) picks.push({ line, position });
  }
  return picks;
}

// 押した点に近い路線を選ぶ。同じ路線データに通称が複数あれば、通称の方面の駅に近いほうにする
export function pickLineAt(
  options: readonly { line: EntryLine; path: readonly Position[] }[],
  point: Position,
): EntryLine | null {
  let best: { line: EntryLine; meters: number } | null = null;
  for (const option of options) {
    const meters = measurePathDistance(point, option.path);
    if (!best || meters < best.meters) best = { line: option.line, meters };
  }
  return best?.line ?? null;
}

// 地図の線から、押した点にいちばん近い路線の ID を返す
export function findNearestLineId(
  features: readonly { lineId: string; paths: readonly (readonly Position[])[] }[],
  point: Position,
): string | null {
  let best: { lineId: string; meters: number } | null = null;
  for (const feature of features) {
    for (const path of feature.paths) {
      const meters = measurePathDistance(point, path);
      if (!best || meters < best.meters) best = { lineId: feature.lineId, meters };
    }
  }
  return best?.lineId ?? null;
}

// 方面を選んだあとに地図へ出す駅。方面の先の駅を近い順に出す
export function listRouteStops(
  direction: EntryDirection,
  limit = ROUTE_STOP_LIMIT,
): DirectionStop[] {
  return direction.stops.slice(0, limit);
}

// 方面を選んだあとの行き先の候補。地図に出した駅を先に並べ、ほかの候補を後ろに続ける
export function mergeRouteCandidates(
  routeStops: readonly DirectionStop[],
  candidates: readonly DirectionStop[],
): DirectionStop[] {
  const merged = [...routeStops, ...candidates];
  return merged.filter((s, i) => merged.findIndex((o) => o.choice.id === s.choice.id) === i);
}

// 押した駅が方面の先にあるか。あれば選んだ路線と方面をそのまま使う
export function isOnRoute(direction: EntryDirection | null, stationId: string): boolean {
  return direction?.stops.some((s) => s.choice.id === stationId) ?? false;
}

// 車内の駅の間。index は stops の並びでの前の駅の位置
export type SegmentPick = { index: number; from: DirectionStop; to: DirectionStop };

// 選んでいる駅の間の前後だけを地図に出す。端では反対側へ寄せて数をそろえる
export function listSegmentWindow(
  stops: readonly DirectionStop[],
  index: number,
  reach = segmentWindow,
): SegmentPick[] {
  const count = Math.max(0, stops.length - 1);
  if (count === 0) return [];
  const span = reach * 2 + 1;
  const start = Math.max(0, Math.min(index - reach, count - span));
  const end = Math.min(count, start + span);
  const picks: SegmentPick[] = [];
  for (let i = start; i < end; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from && to) picks.push({ index: i, from, to });
  }
  return picks;
}

// 押した点に一番近い駅の間を返す。
// maxMeters より遠ければ、押した線は候補の外とみなして決めない
export function findNearestSegment(
  segments: readonly SegmentPick[],
  point: Position,
  maxMeters = Number.POSITIVE_INFINITY,
): SegmentPick | null {
  let best: { segment: SegmentPick; meters: number } | null = null;
  for (const segment of segments) {
    const meters = measureSegmentDistance(point, segment.from.position, segment.to.position);
    if (meters <= maxMeters && (!best || meters < best.meters)) best = { segment, meters };
  }
  return best?.segment ?? null;
}

// 駅の間の押せる丸の半径（px）。駅の印の押せる丸に届かず、ほかの駅の間の丸とは中点の内側に収める
// 小さすぎれば null にし、印だけを出して線を押して選ぶ
export function computeSegmentHitRadii(
  points: readonly ScreenPoint[],
  markers: readonly { point: ScreenPoint; radius: number }[],
  max = 22,
  min = 10,
): (number | null)[] {
  return points.map((point, i) => {
    let radius = max;
    for (const marker of markers) {
      const gap = Math.hypot(point.x - marker.point.x, point.y - marker.point.y) - marker.radius;
      radius = Math.min(radius, gap);
    }
    points.forEach((other, j) => {
      if (j !== i) radius = Math.min(radius, Math.hypot(point.x - other.x, point.y - other.y) / 2);
    });
    return radius >= min ? Math.floor(radius) : null;
  });
}

// 押せる丸が取れない駅の間の丸を、押して寄せるための範囲の半径（px）
// 丸の大きさは保ち、駅の印と、ほかの駅の間との中点には届かせない
export function computeSegmentApproachRadii(
  points: readonly ScreenPoint[],
  markerPoints: readonly ScreenPoint[],
  max = 22,
  min = segmentDotRadius,
): number[] {
  return points.map((point, i) => {
    let radius = max;
    for (const marker of markerPoints) {
      radius = Math.min(
        radius,
        Math.hypot(point.x - marker.x, point.y - marker.y) - stationDotRadius,
      );
    }
    points.forEach((other, j) => {
      if (j !== i) radius = Math.min(radius, Math.hypot(point.x - other.x, point.y - other.y) / 2);
    });
    return Math.max(min, Math.floor(radius));
  });
}

// 引いた地図で駅の間の丸を押したとき、押せる丸が取れるまで寄せる倍率
// 駅の印の押せる丸と、ほかの駅の間の丸から、押せる丸の半径 hit だけ離れる倍率を求める
export function computeSegmentApproachZoom(input: {
  zoom: number;
  point: ScreenPoint;
  markerPoints: readonly ScreenPoint[];
  otherPoints: readonly ScreenPoint[];
  markerRadius?: number;
  hit?: number;
  maxZoom?: number;
}): number {
  const { zoom, point, markerPoints, otherPoints } = input;
  const markerRadius = input.markerRadius ?? 24;
  const hit = input.hit ?? 22;
  const maxZoom = input.maxZoom ?? 17;
  const scales = [
    ...markerPoints.map(
      (p) => (markerRadius + hit) / Math.max(1, Math.hypot(point.x - p.x, point.y - p.y)),
    ),
    ...otherPoints.map((p) => (hit * 2) / Math.max(1, Math.hypot(point.x - p.x, point.y - p.y))),
  ];
  const scale = Math.max(2, ...scales);
  return Math.min(maxZoom, zoom + Math.log2(scale) + 0.1);
}

// 駅の間の中ほどの点
export function computeMidpoint(a: Position, b: Position): Position {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// 駅の間を線路の形に沿って切り出す。判断画面の止まった区間と同じ関数を使う
// 形が無いか切り出せなければ 2 駅を結ぶ
export function buildSegmentPath(
  parts: TrackParts | undefined,
  from: Position,
  to: Position,
): Position[] {
  const sliced = parts ? sliceTrackBetween(parts, from, to) : null;
  return sliced && sliced.length >= 2 ? sliced : [from, to];
}

// 折れ線の長さの半分の点。駅の間の丸を線路の上に置く
export function computePathMidpoint(path: readonly Position[]): Position | null {
  const [first] = path;
  if (!first) return null;
  const lengths = path.slice(1).map((p, i) => {
    const d = toMeters(path[i] as Position, p);
    return Math.hypot(d.x, d.y);
  });
  let rest = lengths.reduce((sum, l) => sum + l, 0) / 2;
  for (const [i, length] of lengths.entries()) {
    const a = path[i] as Position;
    const b = path[i + 1] as Position;
    if (rest <= length) {
      const t = length === 0 ? 0 : rest / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    rest -= length;
  }
  return path.at(-1) ?? first;
}

// 選んだ駅の名前の札を、地図に出す札の向きと反対の側に置く
export function selectAwaySide(origin: Position, points: readonly Position[]): LabelSide | null {
  let x = 0;
  let y = 0;
  for (const point of points) {
    const d = toMeters(origin, point);
    const length = Math.hypot(d.x, d.y);
    if (length === 0) continue;
    x += d.x / length;
    y += d.y / length;
  }
  if (Math.hypot(x, y) < 1e-6) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "left" : "right";
  return y > 0 ? "bottom" : "top";
}

// 路線を選んだあとに地図を押したときの答え。stop があれば、その駅を行き先にする
export type LineTap = { direction: EntryDirection; stop: DirectionStop | null };

// 方面の折れ線。出発の駅から先の駅を順に結ぶ。環状線は反対の方面の終わりの駅まで結んで一周を閉じる
function buildDirectionPath(
  origin: Position,
  direction: EntryDirection,
  closing: DirectionStop | undefined,
): Position[] {
  const stops = closing ? [...direction.stops, closing] : direction.stops;
  return [origin, ...stops.map((s) => s.position)];
}

// 押した点を折れ線に落としたときの、出発の駅からの駅の数と線までの距離
function measurePathProgress(
  point: Position,
  path: readonly Position[],
): { progress: number; meters: number } {
  let best = { progress: Number.POSITIVE_INFINITY, meters: Number.POSITIVE_INFINITY };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const meters = measureSegmentDistance(point, a, b);
    if (meters >= best.meters) continue;
    const ab = toMeters(a, b);
    const ap = toMeters(a, point);
    const length = ab.x * ab.x + ab.y * ab.y;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / length));
    best = { progress: i + t, meters };
  }
  return best;
}

// 押した点のいちばん近くの、地図に印を出している駅。出発の駅がいちばん近ければ "origin"
function findTappedStop(
  origin: Position,
  stops: readonly DirectionStop[],
  point: Position,
  reachMeters: number,
): DirectionStop | null | "origin" {
  let best: { stop: DirectionStop | "origin"; meters: number } | null = null;
  const originMeters = measureSegmentDistance(point, origin, origin);
  if (originMeters <= reachMeters) best = { stop: "origin", meters: originMeters };
  for (const stop of stops) {
    const meters = measureSegmentDistance(point, stop.position, stop.position);
    if (meters <= reachMeters && (!best || meters < best.meters)) best = { stop, meters };
  }
  return best?.stop ?? null;
}

// 駅へ向かう方面。出発の駅からの駅の数が少ない方面にし、同じなら先に並ぶ方面にする
export function selectStopDirection(
  directions: readonly EntryDirection[],
  stationId: string,
): EntryDirection | null {
  const found = directions
    .map((direction, order) => ({
      direction,
      order,
      index: direction.stops.findIndex((s) => s.choice.id === stationId),
    }))
    .filter((c) => c.index >= 0)
    .sort((a, b) => a.index - b.index || a.order - b.order)[0];
  return found?.direction ?? null;
}

// 路線を選んだあとに地図を押したとき、押した点に向かう方面と、近くの駅を決める
// 近くに印を出している駅があれば、その駅を行き先にし、駅の数の少ない方面を選ぶ
// 駅が無ければ、描いた線を押したとき（onLine）だけ、押した点まで駅の数の少ない方面を選ぶ
// 描いた線は駅を結ぶ直線から離れるので、直線までの距離では線の上かを決めない。直線は向きを決めるだけに使う
// 同じ数なら directions の先の方面にする。出発の駅の近くや、線を押していないときは null
export function pickLineTap(input: {
  origin: Position;
  directions: readonly EntryDirection[];
  // 地図に印を出している駅
  stops: readonly DirectionStop[];
  loop: boolean;
  point: Position;
  reachMeters: number;
  onLine: boolean;
}): LineTap | null {
  const { origin, directions, stops, loop, point, reachMeters, onLine } = input;
  const stop = findTappedStop(origin, stops, point, reachMeters);
  if (stop === "origin") return null;
  if (stop) {
    const direction = selectStopDirection(directions, stop.choice.id);
    return direction ? { direction, stop } : null;
  }
  if (!onLine) return null;
  const closingOf = (direction: EntryDirection) =>
    loop ? directions.find((d) => d !== direction)?.stops.at(-1) : undefined;
  const measured = directions.map((direction, order) => ({
    direction,
    order,
    ...measurePathProgress(point, buildDirectionPath(origin, direction, closingOf(direction))),
  }));
  // 押した点にいちばん近い駅の間を通る方面を選ぶ。環状線の反対側のように両方が通れば、駅の数で決める
  const nearest = Math.min(...measured.map((c) => c.meters));
  const chosen = measured
    .filter((c) => c.meters <= nearest + 1)
    .sort((a, b) => a.progress - b.progress || a.order - b.order)[0];
  return chosen ? { direction: chosen.direction, stop: null } : null;
}

// 路線を選んだ直後に地図へ出す駅。出発の駅から両方向とも、近い順に limit 駅まで出す
// 環状線で両方向に同じ駅が出るときは、先の方面の側に 1 つだけ残す
export function listLineStops(
  directions: readonly EntryDirection[],
  limit = ROUTE_STOP_LIMIT,
): DirectionStop[] {
  const stops = directions.flatMap((d) => d.stops.slice(0, limit));
  return stops.filter((s, i) => stops.findIndex((o) => o.choice.id === s.choice.id) === i);
}

// 方面の札の位置。地図に出した駅の先へ、最後の駅の間の半分だけ延ばした点に置き、駅の印と重ねない
export function placeDirectionTag(
  origin: Position,
  direction: EntryDirection,
  limit = ROUTE_STOP_LIMIT,
): Position | null {
  const shown = direction.stops.slice(0, limit);
  const last = shown.at(-1);
  if (!last) return null;
  const before = shown.at(-2)?.position ?? origin;
  return [
    last.position[0] + (last.position[0] - before[0]) * 0.5,
    last.position[1] + (last.position[1] - before[1]) * 0.5,
  ];
}

// 最初の段で、線を押して駅の間を決める倍率。駅の印が出る倍率にそろえる
export const BETWEEN_PICK_MIN_ZOOM = STATION_LABEL_MIN_ZOOM;

// 最初の段で地図を押したときの動き。線が無ければ今どおり、引いた地図の線はまず寄せ、寄った地図の線は駅の間を尋ねる
export function selectRailTapAction(zoom: number, railCount: number): "none" | "approach" | "pick" {
  if (railCount === 0) return "none";
  return zoom >= BETWEEN_PICK_MIN_ZOOM ? "pick" : "approach";
}

// 地図を押した点の答え。駅の印か札なら駅、線の上なら駅の間、どちらでもなければ none
// rail の lineIds は押した点の近くに描いた路線で、近い順に並べる
export type MapTapTarget =
  | { kind: "station"; key: string }
  | { kind: "rail"; lineIds: string[] }
  | { kind: "none" };

// 画面に描いた路線の折れ線
export type ScreenRail = { lineId: string; paths: readonly (readonly ScreenPoint[])[] };

// 線を押したとみなす、押した点から描いた線までの距離（px）。押せる大きさ 44px の半分
export const RAIL_TAP_PX = 22;
// 札の上で、札の下の線を押したとみなす距離（px）。線の幅に指のずれを足した程度
export const LABEL_RAIL_TAP_PX = 8;

// 点から画面の折れ線までの距離（px）
export function measureScreenPathDistance(
  point: ScreenPoint,
  path: readonly ScreenPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length; i++) {
    const a = path[i] as ScreenPoint;
    const b = path[i + 1] ?? a;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const length = abx * abx + aby * aby;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / length));
    best = Math.min(best, Math.hypot(point.x - a.x - abx * t, point.y - a.y - aby * t));
  }
  return best;
}

// 押した点から maxPx の内に描いた路線を、近い順に返す
export function listNearRailIds(
  point: ScreenPoint,
  rails: readonly ScreenRail[],
  maxPx: number,
): string[] {
  const nearest = new Map<string, number>();
  for (const rail of rails) {
    for (const path of rail.paths) {
      const distance = measureScreenPathDistance(point, path);
      if (distance <= maxPx && distance < (nearest.get(rail.lineId) ?? Number.POSITIVE_INFINITY))
        nearest.set(rail.lineId, distance);
    }
  }
  return [...nearest.entries()].sort((a, b) => a[1] - b[1]).map(([lineId]) => lineId);
}

// 押した点が駅か駅の間かを決める
// 印の中心の近く（markRadius の内）なら駅。次に描いた線の近くなら駅の間。札を押したなら、札の下の線の上だけを駅の間にする
// 線から離れていれば、押せる丸（hitRadius）の内の一番近い駅にする。rails が空なら線は見ない
// 駅を受け付けない段では駅を飛ばし、線の上でなければ none にして路線を選ぶ判定へ回す
export function selectMapTapTarget(input: {
  point: ScreenPoint;
  stations: readonly { key: string; point: ScreenPoint; markRadius: number; hitRadius: number }[];
  rails: readonly ScreenRail[];
  // 押した札の駅。札でなければ null
  labelKey: string | null;
  // 駅を答えとして受け付ける段か。受け付けない段では、駅の印と札を見ずに線だけで決める
  placePickable?: boolean;
}): MapTapTarget {
  const { point, rails } = input;
  const pickable = input.placePickable ?? true;
  const stations = pickable ? input.stations : [];
  const labelKey = pickable ? input.labelKey : null;
  const measured = stations
    .map((s) => ({ ...s, distance: Math.hypot(point.x - s.point.x, point.y - s.point.y) }))
    .sort((a, b) => a.distance - b.distance);
  const core = measured.find((s) => s.distance <= s.markRadius);
  if (core) return { kind: "station", key: core.key };
  const lineIds = listNearRailIds(
    point,
    rails,
    labelKey === null ? RAIL_TAP_PX : LABEL_RAIL_TAP_PX,
  );
  if (lineIds.length > 0) return { kind: "rail", lineIds };
  if (labelKey !== null) return { kind: "station", key: labelKey };
  const near = measured.find((s) => s.distance <= s.hitRadius);
  return near ? { kind: "station", key: near.key } : { kind: "none" };
}

// 線を押して出した駅の間の候補の扱い。候補があれば尋ね、無ければ札を押したときはその駅を選ぶ
// 札でもなければ、何も無い所を押したときと同じに扱う
export function selectRailTapOutcome<T>(
  choiceCount: number,
  label: T | null,
): { kind: "ask" } | { kind: "station"; place: T } | { kind: "tap" } {
  if (choiceCount > 0) return { kind: "ask" };
  return label ? { kind: "station", place: label } : { kind: "tap" };
}

// 線を押して出した駅の間の候補を、地図で光らせる強さ。注目している候補がいちばん強い
export const SECTION_FOCUS_STRENGTH = 1;
export const SECTION_REST_STRENGTH = 0.4;

// 地図で光らせる駅の間。駅の間で切った線路の形に、路線色と強さを添える
export type SectionGlow = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "LineString"; coordinates: Position[] };
    properties: { key: string; color: string; strength: number };
  }[];
};

// 候補の駅の間を光らせる形と強さを決める。注目が無いか候補に無ければ先頭の候補を注目にする
// 注目している候補は最後に置き、ほかの候補の上に描く
export function buildSectionGlow(
  choices: readonly GpsChoice[],
  focusKey: string | null,
  trackShapes?: ReadonlyMap<string, TrackParts>,
): SectionGlow {
  const sections = choices.filter(
    (c): c is Extract<GpsChoice, { kind: "between" }> => c.kind === "between",
  );
  const focused = sections.some((c) => c.key === focusKey) ? focusKey : (sections[0]?.key ?? null);
  const features = sections.map((c) => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: buildSegmentPath(
        trackShapes?.get(c.line.lineId),
        [c.from.lon, c.from.lat],
        [c.to.lon, c.to.lat],
      ),
    },
    properties: {
      key: c.key,
      color: c.line.color,
      strength: c.key === focused ? SECTION_FOCUS_STRENGTH : SECTION_REST_STRENGTH,
    },
  }));
  features.sort((a, b) => a.properties.strength - b.properties.strength);
  return { type: "FeatureCollection", features };
}
