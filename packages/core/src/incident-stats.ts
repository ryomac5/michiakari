import type { DurationDist, IncidentCause } from "@repo/schema";
import {
  COMMUTE_HOUR_RANGES,
  MONTE_CARLO_SAMPLE_COUNT,
  MONTE_CARLO_SEED,
} from "../params/estimation.ts";
import {
  type DurationPeriod,
  INCIDENT_GROUP_DURATIONS,
  INCIDENT_TYPE_DURATIONS,
  type IncidentDurationStats,
  type IncidentGroupDurations,
  type IncidentGroupId,
  type IncidentTypeDurations,
  type IncidentTypeId,
} from "../params/incident-durations.ts";
import { fitDurationModel, sampleRemainingDuration } from "./duration-model.ts";
import { createMulberry32 } from "./random.ts";
import { summarizeSamples } from "./remaining.ts";
import { diffMinutes, parseIsoToMs } from "./time.ts";

// 知見の無い原因の、集めた事例の統計値からの再開の見込み
// 統計値は報道に残った事例なので長引いたものに偏る。幅は p50 と p80 から作る

const JST_OFFSET_MS = 9 * 60 * 60_000;

export type IncidentDurationTables = {
  groups: IncidentGroupDurations;
  types: IncidentTypeDurations;
};

const defaultTables: IncidentDurationTables = {
  groups: INCIDENT_GROUP_DURATIONS,
  types: INCIDENT_TYPE_DURATIONS,
};

// 止まった時刻の時間帯。日本時間の平日で COMMUTE_HOUR_RANGES の時台なら commute、それ以外は other。祝日は区別しない
export function classifyDurationPeriod(stoppedAt: string): DurationPeriod {
  const d = new Date(parseIsoToMs(stoppedAt) + JST_OFFSET_MS);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  const weekday = day >= 1 && day <= 5;
  const inCommute = COMMUTE_HOUR_RANGES.some(([from, to]) => hour >= from && hour < to);
  return weekday && inCommute ? "commute" : "other";
}

export type ResolvedIncidentDuration = {
  // 種類の値を使ったか、大分類の値を使ったか
  level: "type" | "group";
  id: IncidentGroupId | IncidentTypeId;
  period: DurationPeriod;
  // 発生から再開までの所要時間（分）
  duration: DurationDist;
};

function isKeyOf<T extends object>(table: T, id: string): id is Extract<keyof T, string> {
  return Object.hasOwn(table, id);
}

// 時間帯の値を取る。use_mixed の区分は p50 と p80 にまぜた値が入っているので、そのまま使う
function pickPeriodDuration(
  stats: IncidentDurationStats,
  period: DurationPeriod,
): DurationDist | null {
  const byPeriod = stats.byPeriod[period];
  const p50 = byPeriod.p50 ?? stats.p50;
  const p80 = byPeriod.p80 ?? stats.p80;
  return p50 === null || p80 === null ? null : { p50, p80 };
}

// 原因から使う統計値を決める。種類の値が足りれば種類、use_group か null なら大分類、大分類も無ければ null
export function resolveIncidentDuration(
  cause: IncidentCause,
  stoppedAt: string,
  tables: IncidentDurationTables = defaultTables,
): ResolvedIncidentDuration | null {
  if (!isKeyOf(tables.groups, cause.group)) return null;
  const period = classifyDurationPeriod(stoppedAt);
  const type = cause.type;
  if (type !== null && isKeyOf(tables.types, type)) {
    const stats = tables.types[type];
    const duration =
      stats.groupId === cause.group && stats.reliability === "sufficient"
        ? pickPeriodDuration(stats, period)
        : null;
    if (duration) return { level: "type", id: type, period, duration };
  }
  const group = tables.groups[cause.group];
  if (group.reliability === "insufficient") return null;
  const duration = pickPeriodDuration(group, period);
  return duration ? { level: "group", id: cause.group, period, duration } : null;
}

export type StatsRemaining = {
  // 運転再開までの残り（分）。初列車待ちは含めない
  remaining: DurationDist;
  // 確率の計算に使う残りの標本（分、昇順）。remaining はこの標本の分位点
  samples: number[];
  resolved: ResolvedIncidentDuration;
};

// 所要時間を対数正規分布に当て、発生からの経過を超えた条件付きの残りを標本にする
// 経過の差し引き方は、知見の段階の残りと同じ sampleRemainingDuration を使う
export function sampleStatsRemaining(
  duration: DurationDist,
  elapsedSinceOnsetMinutes: number,
): number[] {
  if (!Number.isFinite(elapsedSinceOnsetMinutes) || elapsedSinceOnsetMinutes < 0) {
    throw new RangeError(`発生からの経過は 0 以上の有限値: ${elapsedSinceOnsetMinutes}`);
  }
  const model = fitDurationModel(duration);
  const random = createMulberry32(MONTE_CARLO_SEED);
  const samples: number[] = new Array(MONTE_CARLO_SAMPLE_COUNT);
  for (let i = 0; i < MONTE_CARLO_SAMPLE_COUNT; i++) {
    samples[i] = sampleRemainingDuration(model, elapsedSinceOnsetMinutes, random);
  }
  return samples.sort((a, b) => a - b);
}

// 原因の統計値から、いまから再開までの残りを見積もる。使える統計値が無ければ null
// 経過は知見の見込みと同じく、発生とみなした時刻からの分を切り捨てて数える
export function estimateStatsRemaining(
  cause: IncidentCause,
  onsetTime: string,
  now: string,
  tables: IncidentDurationTables = defaultTables,
): StatsRemaining | null {
  const resolved = resolveIncidentDuration(cause, onsetTime, tables);
  if (!resolved) return null;
  const elapsed = Math.max(0, Math.floor(diffMinutes(onsetTime, now)));
  const samples = sampleStatsRemaining(resolved.duration, elapsed);
  return { remaining: summarizeSamples(samples), samples, resolved };
}
