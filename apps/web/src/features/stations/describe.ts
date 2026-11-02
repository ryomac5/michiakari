import type { Place } from "@repo/schema";
import { provisionalStations } from "./fixtures/stations";
import { describeStationPlace, findNearestStation, pickStationName } from "./search";

// 地点の表示名。座標の地点は「現在地」と最寄り駅で表す

export type PlaceLabel = {
  label: string;
  nearest: { station: string; meters: number } | null;
};

export function describePlace(
  place: Place,
  locale: string,
  currentLocationLabel: string,
): PlaceLabel {
  if (place.kind === "station") {
    return { label: describeStationPlace(provisionalStations, place, locale), nearest: null };
  }
  const nearest = findNearestStation(provisionalStations, place);
  return {
    label: currentLocationLabel,
    nearest: nearest
      ? { station: pickStationName(nearest.station, locale), meters: nearest.meters }
      : null,
  };
}

// 距離の概数。1km 未満は 50m 単位、それ以上は 0.1km 単位
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
