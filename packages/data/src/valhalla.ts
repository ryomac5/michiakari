import type { IsochroneGeometry, LonLat } from "@repo/geo";

// ローカルの Valhalla への問い合わせ。pedestrian の経路と到達範囲だけを使う

export const VALHALLA_URL = process.env.VALHALLA_URL ?? "http://localhost:8002";

// packages/core の歩く速さ 80m/分 に揃える（4.8km/h）
export const WALKING_SPEED_KMH = 4.8;

const PEDESTRIAN = {
  costing: "pedestrian",
  costing_options: { pedestrian: { walking_speed: WALKING_SPEED_KMH } },
};

export type WalkRoute = { seconds: number; meters: number };

type RouteResponse = { trip?: { summary?: { time: number; length: number } } };

type IsochroneResponse = {
  features?: {
    properties?: { contour?: number };
    geometry: IsochroneGeometry | { type: string; coordinates: unknown };
  }[];
};

const toLocation = ([lon, lat]: LonLat) => ({ lon, lat });

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${VALHALLA_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as T };
}

export async function fetchValhallaVersion(): Promise<string | null> {
  const res = await fetch(`${VALHALLA_URL}/status`).catch(() => null);
  if (!res?.ok) return null;
  const status = (await res.json()) as { version?: string };
  return status.version ?? null;
}

// 経路が無いときは null
export async function fetchWalkRoute(from: LonLat, to: LonLat): Promise<WalkRoute | null> {
  const { status, json } = await postJson<RouteResponse>("/route", {
    ...PEDESTRIAN,
    locations: [toLocation(from), toLocation(to)],
    units: "kilometers",
    directions_type: "none",
  });
  const summary = json.trip?.summary;
  if (status !== 200 || !summary) return null;
  return { seconds: summary.time, meters: summary.length * 1000 };
}

// 分ごとの到達範囲。generalizeMeters で Valhalla 側に単純化させる
export async function fetchWalkIsochrones(
  origin: LonLat,
  minutes: readonly number[],
  generalizeMeters: number,
): Promise<Map<number, IsochroneGeometry>> {
  const { status, json } = await postJson<IsochroneResponse>("/isochrone", {
    ...PEDESTRIAN,
    locations: [toLocation(origin)],
    contours: minutes.map((time) => ({ time })),
    polygons: true,
    denoise: 0.5,
    generalize: generalizeMeters,
  });
  const result = new Map<number, IsochroneGeometry>();
  if (status !== 200) return result;
  for (const feature of json.features ?? []) {
    const contour = feature.properties?.contour;
    const { geometry } = feature;
    if (contour === undefined) continue;
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      result.set(contour, geometry as IsochroneGeometry);
    }
  }
  return result;
}
