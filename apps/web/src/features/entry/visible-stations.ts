import { computeDistanceMeters } from "@repo/geo";
import {
  type LayoutItem,
  overlapArea,
  placeBox,
  type Rect,
  type ScreenPoint,
} from "@/features/map/bubble-layout";
import type { LabelSide } from "./areas";
import { entryAreas } from "./areas";
import {
  type EntryData,
  type EntryPlace,
  listGroupLines,
  pickPlaceName,
  resolveConfiguredArea,
} from "./entry-places";

export const STATION_LABEL_MIN_ZOOM = 12.5;
// 引いた地図で名前を出す駅の乗降客数の下限。倍率 11 で 20 万人から寄るほど下げる
const overviewPassengers = { zoom: 11, passengers: 200000, perZoom: 75000, floor: 50000 };
// 寄せた地図で大きな札にする駅の乗降客数
const majorPassengers = 100000;
const hitMargin = 6;
const configuredStationMeters = 1000;
// 札の大きさ。large は路線色の帯の付いた札、small は印の横の小さな文字
const labelStyles = {
  large: { gap: 14, height: 28, padding: 32, perColor: 8, fullWidth: 13, halfWidth: 8 },
  small: { gap: 9, height: 18, padding: 12, perColor: 7, fullWidth: 11, halfWidth: 6.5 },
} as const;
// 選んだ駅の札に足す「ここ」の幅（px）
const hereWidth = 28;
const dotRadius = { large: 8, small: 6 } as const;
// 押せる丸の半径の上限（px）。隣の印に届くときは、その印の手前まで縮める
const maxHitRadius = { large: 24, small: 22 } as const;
// 札の幅の見積もりのずれを吸収する余白（px）
const margin = 3;
const sideOrder: readonly LabelSide[] = ["right", "left", "top", "bottom"];
// 札を辺の方向へずらせる量の候補（px）。ずらさない置き方を先に試す
const slides = [0, -12, 12, -24, 24] as const;
// 関西の段の丸がまとめて示す駅。引いた地図では丸に任せ、駅としては出さない
const hubPlaceKeys = new Set(entryAreas.flatMap((area) => area.places.map((place) => place.key)));

export type MapStation = { place: EntryPlace; passengers: number };

// 表示名の設定を保ち、手書きの一覧に無い駅も全駅から候補に入れる。
export function listMapStations(data: EntryData): MapStation[] {
  const configured = entryAreas.flatMap(
    (area) => resolveConfiguredArea(data, area.id)?.places ?? [],
  );
  const seen = new Set<string>();
  return data.catalog.groups.flatMap((group) => {
    const choice = group.choice;
    const match = configured.find((place) =>
      place.lines.some(
        (line) =>
          line.stationName === choice.name &&
          computeDistanceMeters(place.position, [choice.lon, choice.lat]) <=
            configuredStationMeters,
      ),
    );
    const place: EntryPlace = match ?? {
      key: choice.id,
      name: { ja: choice.name, en: choice.nameEn },
      position: [choice.lon, choice.lat],
      side: { wide: "right", narrow: "right" },
      lines: listGroupLines(data, group),
    };
    if (seen.has(place.key)) return [];
    seen.add(place.key);
    const passengers = match
      ? data.catalog.groups
          .filter((g) =>
            match.lines.some(
              (l) =>
                l.stationName === g.choice.name &&
                computeDistanceMeters(match.position, [g.choice.lon, g.choice.lat]) <=
                  configuredStationMeters,
            ),
          )
          .reduce((sum, g) => sum + g.passengers, 0)
      : group.passengers;
    return [{ place, passengers }];
  });
}

// 札の文字の幅の見積もり（px）。全角と半角で 1 文字の幅を変える
export function estimateTextWidth(text: string, fullWidth: number, halfWidth: number): number {
  return [...text].reduce(
    (width, char) => width + ((char.codePointAt(0) ?? 0) > 127 ? fullWidth : halfWidth),
    0,
  );
}

export type StationLabelSize = keyof typeof labelStyles;
// 地図に出す駅。label が null の駅は、名前が重なるので印だけを出す
// hitRadius は押せる丸の半径。tappable は札も押せるかで、ほかの駅の押せる丸に掛かる札は押せない
export type VisibleStation = {
  place: EntryPlace;
  major: boolean;
  hitRadius: number;
  label: { side: LabelSide; size: StationLabelSize; slide: number; tappable: boolean } | null;
};

// 地図の上のほかの押せる丸。関西の段の大きな丸
export type MapTarget = { point: ScreenPoint; dotRadius: number; hitRadius: number };

function containsRect(view: Rect, box: Rect): boolean {
  return (
    box.left >= view.left &&
    box.right <= view.right &&
    box.top >= view.top &&
    box.bottom <= view.bottom
  );
}

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

// 駅の印の矩形。大きな駅は大きな丸にする
export function buildStationDotRect(point: ScreenPoint, major: boolean): Rect {
  return buildDotRect(point, dotRadius[major ? "large" : "small"]);
}

// 引いた地図で名前を出す駅の乗降客数の下限
export function computeOverviewThreshold(zoom: number): number {
  const { passengers, perZoom, floor } = overviewPassengers;
  return Math.max(floor, passengers - (zoom - overviewPassengers.zoom) * perZoom);
}

// 札の矩形。名前の文字幅と路線色の数から見積もる
export function buildStationLabelRect(input: {
  point: ScreenPoint;
  label: string;
  colors: number;
  size: StationLabelSize;
  side: LabelSide;
  slide?: number;
  selected?: boolean;
}): Rect {
  const style = labelStyles[input.size];
  const item: LayoutItem = {
    key: input.label,
    point: input.point,
    gap: style.gap,
    size: {
      w:
        estimateTextWidth(input.label, style.fullWidth, style.halfWidth) +
        style.padding +
        Math.min(input.colors, 4) * style.perColor +
        (input.selected ? hereWidth : 0),
      h: style.height,
    },
  };
  return expandRect(placeBox(item, input.side, input.slide ?? 0), margin);
}

type Candidate = MapStation & { point: ScreenPoint; major: boolean; selected: boolean };

// 引いた地図は乗降客数の多い駅だけを、名前が置けるときに出す。丸と縁の札は blockers で避ける
// 寄せた地図は見えている駅の印を全部出し、名前は大きな札、小さな文字、隠すの順に試す
export function selectVisibleStations(input: {
  stations: readonly MapStation[];
  zoom: number;
  view: Rect;
  project: (position: [number, number]) => ScreenPoint;
  locale: string;
  selectedKey?: string;
  // 先に置いてある札と丸の矩形。関西の段の丸と縁の札
  blockers?: readonly Rect[];
  // 名前を先に置く駅。開いたエリアのシートに並ぶ駅
  priorityKeys?: readonly string[];
  // 先に置いてある押せる丸。駅の印と押せる丸は、これと互いに届かないように置く
  targets?: readonly MapTarget[];
}): VisibleStation[] {
  const overview = input.zoom < STATION_LABEL_MIN_ZOOM;
  const priority = new Set(input.priorityKeys ?? []);
  const threshold = overview ? computeOverviewThreshold(input.zoom) : 0;
  const candidates: Candidate[] = input.stations
    .filter((station) => {
      if (station.place.key === input.selectedKey) return true;
      if (!overview) return true;
      return station.passengers >= threshold && !hubPlaceKeys.has(station.place.key);
    })
    .map((station) => {
      const selected = station.place.key === input.selectedKey;
      return {
        ...station,
        point: input.project(station.place.position),
        selected,
        major: selected || (!overview && station.passengers >= majorPassengers),
      };
    })
    .filter(({ point }) => containsRect(input.view, buildDotRect(point, hitMargin)))
    .sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        Number(priority.has(b.place.key)) - Number(priority.has(a.place.key)) ||
        b.passengers - a.passengers ||
        a.place.key.localeCompare(b.place.key),
    );
  const dotOf = (c: Candidate) => buildStationDotRect(c.point, c.major);
  const blockers: Rect[] = [...(input.blockers ?? [])];
  // 寄せた地図では印を必ず出すので、どの札も先にすべての印を避ける
  const dots = overview ? [] : candidates.map((c) => ({ key: c.place.key, rect: dotOf(c) }));
  const labels: Rect[] = [];
  const fits = (box: Rect, key: string) =>
    containsRect(input.view, box) &&
    [...blockers, ...labels].every((rect) => overlapArea(box, rect) === 0) &&
    dots.every((dot) => dot.key === key || overlapArea(box, dot.rect) === 0);
  const targets = input.targets ?? [];
  const picked: {
    candidate: Candidate;
    label: { side: LabelSide; size: StationLabelSize; slide: number; box: Rect } | null;
  }[] = [];
  for (const candidate of candidates) {
    const { place, point, major, selected } = candidate;
    const dot = dotOf(candidate);
    // 引いた地図の駅は、印が丸や先の駅とぶつかるか、丸の押せる範囲に入るなら出さない
    if (overview && [...blockers, ...labels].some((rect) => overlapArea(dot, rect) > 0)) continue;
    if (
      overview &&
      targets.some(
        (t) => measureDistance(t.point, point) < t.hitRadius + dotRadius[major ? "large" : "small"],
      )
    )
      continue;
    const name = pickPlaceName(place, input.locale);
    const colors = new Set(place.lines.map((line) => line.color)).size;
    const sizes: StationLabelSize[] = major ? ["large", "small"] : ["small"];
    const sides = [...new Set([place.side.wide, ...sideOrder])];
    const label =
      sizes
        .flatMap((size) => slides.flatMap((slide) => sides.map((side) => ({ size, side, slide }))))
        .map((option) => ({
          ...option,
          box: buildStationLabelRect({ point, label: name, colors, selected, ...option }),
        }))
        .find((option) => fits(option.box, place.key)) ?? null;
    if (overview && !label && !selected) continue;
    if (overview) blockers.push(dot);
    if (label) labels.push(label.box);
    picked.push({ candidate, label: label ? { ...label } : null });
  }
  return assignHitAreas(picked, targets);
}

function measureDistance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 押せる丸を、ほかの駅や丸の印に届かない大きさにする。札は、ほかの押せる丸に掛からないときだけ押せる
function assignHitAreas(
  picked: readonly {
    candidate: Candidate;
    label: { side: LabelSide; size: StationLabelSize; slide: number; box: Rect } | null;
  }[],
  targets: readonly MapTarget[],
): VisibleStation[] {
  const others = (key: string): MapTarget[] => [
    ...targets,
    ...picked
      .filter((p) => p.candidate.place.key !== key)
      .map((p) => ({
        point: p.candidate.point,
        dotRadius: dotRadius[p.candidate.major ? "large" : "small"],
        hitRadius: 0,
      })),
  ];
  const hits = picked.map(({ candidate }) => {
    const size = candidate.major ? "large" : "small";
    const room = others(candidate.place.key).map(
      (o) => measureDistance(o.point, candidate.point) - o.dotRadius,
    );
    return Math.max(dotRadius[size], Math.min(maxHitRadius[size], ...room));
  });
  const circles: (MapTarget & { key: string })[] = [
    ...targets.map((t, i) => ({ ...t, key: `target:${i}` })),
    ...picked.map((p, i) => ({
      key: p.candidate.place.key,
      point: p.candidate.point,
      dotRadius: 0,
      hitRadius: hits[i] ?? 0,
    })),
  ];
  return picked.map(({ candidate, label }, i) => ({
    place: candidate.place,
    major: candidate.major,
    hitRadius: hits[i] ?? 0,
    label: label
      ? {
          side: label.side,
          size: label.size,
          slide: label.slide,
          tappable: circles.every(
            (c) =>
              c.key === candidate.place.key ||
              overlapArea(label.box, buildDotRect(c.point, c.hitRadius)) === 0,
          ),
        }
      : null,
  }));
}
