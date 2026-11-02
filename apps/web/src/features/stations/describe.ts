import type { Place } from "@repo/schema";
import type { StationChoice } from "./catalog";

// 地点と駅の表示名。英語画面ではローマ字の駅名を使い、無ければ日本語のまま出す

// 駅名（日本語）から英語の表示名への対応。選んだ駅とシナリオの駅だけを持つ
export type StationNames = Record<string, string | null>;

export type NearestStationLabel = { name: string; nameEn: string | null; meters: number };

export type PlaceLabel = {
  label: string;
  nearest: { station: string; meters: number } | null;
};

export function pickStationName(
  station: { name: string; nameEn: string | null },
  locale: string,
): string {
  return locale === "en" && station.nameEn ? station.nameEn : station.name;
}

export function describePlace(
  place: Place,
  locale: string,
  currentLocationLabel: string,
  names: StationNames,
  nearest: NearestStationLabel | null = null,
): PlaceLabel {
  if (place.kind === "station") {
    return {
      label: pickStationName({ name: place.name, nameEn: names[place.name] ?? null }, locale),
      nearest: null,
    };
  }
  return {
    label: currentLocationLabel,
    nearest: nearest ? { station: pickStationName(nearest, locale), meters: nearest.meters } : null,
  };
}

// 候補に添える路線の要約。日本語は事業者と路線、英語は事業者名入りの路線名を並べる
export function describeStationLines(station: StationChoice, locale: string): string {
  if (locale === "en") return station.operators.flatMap((o) => o.linesEn).join(" · ");
  return station.operators.map((o) => `${o.name} ${o.lines.join("・")}`).join(" ／ ");
}

// 距離の概数。1km 未満は 50m 単位、それ以上は 0.1km 単位
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
