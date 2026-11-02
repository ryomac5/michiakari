import { computeHaversineMeters, getJstMinuteOfDay, type LonLat, parseIsoToMs } from "@repo/core";
import { z } from "zod";
import { weatherParams } from "../config.ts";
import type { RainReading } from "../domain/weather.ts";
import type { RainFetcher } from "./types.ts";

// 気象庁アメダスの 10 分間降水量を、公開 JSON から最寄りの観測所で取得する
// 出典: 気象庁（data-sources.md）。警報・注意報はここでは取得しない

const AMEDAS_BASE = "https://www.jma.go.jp/bosai/amedas";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const AmedasTableSchema = z.record(
  z.string(),
  z.object({
    elems: z.string(),
    lat: z.tuple([z.number(), z.number()]),
    lon: z.tuple([z.number(), z.number()]),
    kjName: z.string(),
  }),
);

const AmedasPointSchema = z.record(
  z.string(),
  z.object({ precipitation10m: z.array(z.number().nullable()).optional() }),
);

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

let tableCache: z.infer<typeof AmedasTableSchema> | null = null;

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(weatherParams.fetchTimeoutMs) });
  if (!res.ok) throw new Error(`気象庁のデータを取得できません: ${url}`);
  return res.json();
}

// 降水量を観測している最寄りの観測所
function findNearestRainStation(table: z.infer<typeof AmedasTableSchema>, coord: LonLat) {
  let best: { code: string; name: string; meters: number } | null = null;
  for (const [code, s] of Object.entries(table)) {
    if (s.elems[1] !== "1") continue;
    const point: LonLat = [s.lon[0] + s.lon[1] / 60, s.lat[0] + s.lat[1] / 60];
    const meters = computeHaversineMeters(coord, point);
    if (!best || meters < best.meters) best = { code, name: s.kjName, meters };
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, "0");

// 日本時間の YYYYMMDD と 3 時間ごとの区切り
function formatPointBlock(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  const block = Math.floor(d.getUTCHours() / 3) * 3;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(block)}`;
}

function convertKeyToIso(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T${key.slice(8, 10)}:${key.slice(10, 12)}:00+09:00`;
}

export function createAmedasRainFetcher(
  fetchImpl: FetchLike = fetch,
  logWarning: (message: string) => void = () => {},
): RainFetcher {
  return async ({ coord, now, windowMinutes }) => {
    try {
      tableCache ??= AmedasTableSchema.parse(
        await fetchJson(fetchImpl, `${AMEDAS_BASE}/const/amedastable.json`),
      );
      const station = findNearestRainStation(tableCache, coord);
      if (!station) return null;

      const endMs = parseIsoToMs(now);
      const startMs = endMs - windowMinutes * 60_000;
      const blocks = [...new Set([formatPointBlock(startMs), formatPointBlock(endMs)])];
      const readings: RainReading[] = [];
      for (const block of blocks) {
        const data = AmedasPointSchema.parse(
          await fetchJson(fetchImpl, `${AMEDAS_BASE}/data/point/${station.code}/${block}.json`),
        );
        for (const [key, value] of Object.entries(data)) {
          const time = convertKeyToIso(key);
          const ms = parseIsoToMs(time);
          if (ms < startMs || ms > endMs || getJstMinuteOfDay(time) % 10 !== 0) continue;
          readings.push({
            time,
            rainfall10minMm: value.precipitation10m?.[0] ?? null,
            warnings: [],
          });
        }
      }
      readings.sort((a, b) => parseIsoToMs(a.time) - parseIsoToMs(b.time));
      return { stationName: station.name, readings };
    } catch (error) {
      // 利用者の入力と位置は出さず、失敗の種類だけ残す
      logWarning(
        `アメダスの雨量を取得できませんでした: ${error instanceof Error ? error.name : "unknown"}`,
      );
      return null;
    }
  };
}
