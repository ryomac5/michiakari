import {
  NearestResponseSchema,
  type NearestStationChoice,
  type StationChoice,
  StationSearchResponseSchema,
} from "./catalog";

// 駅検索 API の呼び出し。応答は境界で検証する

export async function fetchStationChoices(
  query: string,
  signal?: AbortSignal,
): Promise<StationChoice[]> {
  const res = await fetch(`/api/stations?${new URLSearchParams({ q: query })}`, { signal });
  if (!res.ok) throw new Error(`駅検索に失敗しました: ${res.status}`);
  return StationSearchResponseSchema.parse(await res.json()).stations;
}

// 位置は本文で送り、URL やキャッシュに残さない
export async function fetchNearestStations(
  point: { lat: number; lon: number },
  signal?: AbortSignal,
): Promise<NearestStationChoice[]> {
  const res = await fetch("/api/stations/nearest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: point.lat, lon: point.lon }),
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`最寄り駅の取得に失敗しました: ${res.status}`);
  return NearestResponseSchema.parse(await res.json()).nearest;
}
