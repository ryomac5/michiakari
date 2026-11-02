import { type GeoIndex, ISOCHRONE_MINUTES } from "@repo/geo";
import { z } from "zod";
import { resolveStationByName } from "./scene";

// 徒歩の到達範囲（Valhalla の事前計算）。データは大きいので、サーバーが現在地の駅の分だけを返す

const PositionSchema = z.tuple([z.number(), z.number()]);
const RingSchema = z.array(PositionSchema);

export const ReachGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(RingSchema) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(RingSchema)) }),
]);

export const ReachAreaSchema = z.object({
  minutes: z.number().int().positive(),
  geometry: ReachGeometrySchema,
});
export type ReachArea = z.infer<typeof ReachAreaSchema>;

// stationId は到達範囲を引いた駅。駅が引けなければ null、範囲が無ければ areas は空
export const ReachResponseSchema = z.object({
  stationId: z.string().nullable(),
  areas: z.array(ReachAreaSchema),
});
export type ReachResponse = z.infer<typeof ReachResponseSchema>;

// 駅名から、地図の現在地と同じ駅を引き、その駅の 10 分と 20 分の範囲を返す。片方でも欠ければ空にする
export function findReachAreas(index: GeoIndex, stationName: string): ReachResponse {
  const station = resolveStationByName(index, stationName);
  if (!station) return { stationId: null, areas: [] };
  const areas = ISOCHRONE_MINUTES.flatMap((minutes) => {
    const feature = index.getIsochrone(station.stationId, minutes);
    return feature ? [{ minutes, geometry: feature.geometry as ReachArea["geometry"] }] : [];
  });
  return {
    stationId: station.stationId,
    areas: areas.length === ISOCHRONE_MINUTES.length ? areas : [],
  };
}

export async function fetchReachAreas(
  stationName: string,
  signal?: AbortSignal,
): Promise<ReachArea[]> {
  const res = await fetch(`/api/reach?${new URLSearchParams({ station: stationName })}`, {
    signal,
  });
  if (!res.ok) throw new Error(`到達範囲の取得に失敗しました: ${res.status}`);
  return ReachResponseSchema.parse(await res.json()).areas;
}
