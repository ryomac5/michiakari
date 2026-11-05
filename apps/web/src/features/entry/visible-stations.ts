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

export const STATION_LABEL_MIN_ZOOM = 13;
const detailZoom = 15;
const majorPassengers = 10000;
const labelGap = 14;
const dotRadius = 10;
const hitRadius = 22;
const configuredStationMeters = 1000;

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

function containsRect(view: Rect, box: Rect): boolean {
  return (
    box.left >= view.left &&
    box.right <= view.right &&
    box.top >= view.top &&
    box.bottom <= view.bottom
  );
}

// 可視範囲と拡大率で絞り、乗降客数順に札と印が重ならない置き方を選ぶ。
export function selectVisibleStations(input: {
  stations: readonly MapStation[];
  zoom: number;
  view: Rect;
  project: (position: [number, number]) => ScreenPoint;
  locale: string;
  selectedKey?: string;
}): EntryPlace[] {
  if (input.zoom < STATION_LABEL_MIN_ZOOM) return [];
  const threshold =
    input.zoom >= detailZoom
      ? 0
      : (majorPassengers * (detailZoom - input.zoom)) / (detailZoom - STATION_LABEL_MIN_ZOOM);
  const candidates = input.stations
    .filter((station) => station.place.key === input.selectedKey || station.passengers >= threshold)
    .map((station) => ({ ...station, point: input.project(station.place.position) }))
    .filter(({ point }) =>
      containsRect(input.view, {
        left: point.x - hitRadius,
        right: point.x + hitRadius,
        top: point.y - hitRadius,
        bottom: point.y + hitRadius,
      }),
    )
    .sort(
      (a, b) =>
        Number(b.place.key === input.selectedKey) - Number(a.place.key === input.selectedKey) ||
        b.passengers - a.passengers ||
        a.place.key.localeCompare(b.place.key),
    );
  const picked: { place: EntryPlace; box: Rect; dot: Rect }[] = [];
  for (const { place, point } of candidates) {
    const colors = new Set(place.lines.map((line) => line.color)).size;
    const label = pickPlaceName(place, input.locale);
    const textWidth = estimateTextWidth(label, 13, 8);
    const item: LayoutItem = {
      key: place.key,
      point,
      gap: labelGap,
      size: {
        w: textWidth + (place.key === input.selectedKey ? 60 : 32) + Math.min(colors, 4) * 8,
        h: 28,
      },
    };
    const dot = {
      left: point.x - dotRadius,
      right: point.x + dotRadius,
      top: point.y - dotRadius,
      bottom: point.y + dotRadius,
    };
    if (picked.some((other) => overlapArea(dot, other.box) > 0 || overlapArea(dot, other.dot) > 0))
      continue;
    const sides: LabelSide[] = [place.side.wide, "right", "left", "top", "bottom"];
    for (const side of new Set(sides)) {
      const box = placeBox(item, side);
      if (!containsRect(input.view, box)) continue;
      if (
        picked.some((other) => overlapArea(box, other.box) > 0 || overlapArea(box, other.dot) > 0)
      )
        continue;
      picked.push({ place: { ...place, side: { wide: side, narrow: side } }, box, dot });
      break;
    }
  }
  return picked.map(({ place }) => place);
}
