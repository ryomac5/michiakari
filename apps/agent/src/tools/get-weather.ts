import { addMinutesToIso, type LonLat, parseIsoToMs } from "@repo/core";
import type { Scenario } from "@repo/schema";
import { z } from "zod";
import { weatherParams } from "../config.ts";
import { type RainReading, summarizeRain } from "../domain/weather.ts";
import type { ToolContext, WeatherToolResult } from "./types.ts";

export const GetWeatherInputSchema = z.object({
  windowMinutes: z
    .number()
    .int()
    .min(10)
    .max(180)
    .optional()
    .describe("さかのぼる時間幅（分）。省略時は 60"),
});

export const getWeatherDefinition = {
  name: "get_weather",
  description:
    "止まっている区間の付近の 10 分ごとの雨量と警報の発表状況を返す（出典: 気象庁）。大雨・強風など気象が関わる事象で呼ぶ。取得できなければ unavailable を返すので、そのまま判断を続ける。",
  inputSchema: GetWeatherInputSchema,
} as const;

// リプレイではシナリオの架空の観測値を、現在時刻までの範囲で返す
function selectScenarioReadings(
  scenario: Scenario,
  now: string,
  windowMinutes: number,
): RainReading[] {
  const endMs = parseIsoToMs(now);
  const startMs = endMs - windowMinutes * 60_000;
  return (scenario.weather?.readings ?? [])
    .map((r) => ({
      time: addMinutesToIso(scenario.start_time, r.offset_minutes),
      rainfall10minMm: r.rainfall_10min_mm,
      warnings: r.warnings,
    }))
    .filter((r) => {
      const ms = parseIsoToMs(r.time);
      return ms >= startMs && ms <= endMs;
    });
}

// 止まっている区間の中点。区間が分からなければ現在地
function locateBlockedArea(ctx: ToolContext): LonLat | null {
  const section = [...ctx.observations].reverse().find((o) => o.section !== null)?.section ?? null;
  const ends = section
    ? [section.fromStation, section.toStation].map((name) =>
        ctx.provider.resolvePlace({ kind: "station", name }),
      )
    : [];
  const [a, b] = ends;
  if (a && b) return [(a.coord[0] + b.coord[0]) / 2, (a.coord[1] + b.coord[1]) / 2];
  return ctx.provider.resolvePlace(ctx.request.origin)?.coord ?? null;
}

export async function runGetWeather(
  ctx: ToolContext,
  input: z.infer<typeof GetWeatherInputSchema>,
): Promise<WeatherToolResult> {
  const windowMinutes = input.windowMinutes ?? weatherParams.defaultWindowMinutes;
  if (ctx.scenario) {
    const readings = selectScenarioReadings(ctx.scenario, ctx.request.now, windowMinutes);
    return { source: "scenario", stationName: null, readings, summary: summarizeRain(readings) };
  }
  const coord = locateBlockedArea(ctx);
  const fetched = coord
    ? await ctx.fetchRain({ coord, now: ctx.request.now, windowMinutes })
    : null;
  if (!fetched) {
    return { source: "unavailable", stationName: null, readings: [], summary: summarizeRain([]) };
  }
  return {
    source: "jma_amedas",
    stationName: fetched.stationName,
    readings: fetched.readings,
    summary: summarizeRain(fetched.readings),
  };
}
