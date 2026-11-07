import type { DurationDist, IncidentCause } from "@repo/schema";
import type { AnnouncementCueId } from "../params/announcement-cues.ts";
import { INCIDENT_BEHAVIOR, type IncidentFlowOutlook } from "../params/incident-behavior.ts";
import { INCIDENT_TYPE_DURATIONS, type IncidentTypeId } from "../params/incident-durations.ts";
import { resolveFirstTrainWait, resolveFlowOutlook } from "./incident-rules.ts";
import {
  estimateStatsRemaining,
  type IncidentDurationTables,
  type ResolvedIncidentDuration,
} from "./incident-stats.ts";
import { estimateStatedRemainingWithoutKnowledge } from "./remaining-paths.ts";
import { diffMinutes } from "./time.ts";

// 規則表、発表、統計値から、乗れるまでの残りを見積もる。上から順に当てはめる
// 1. 再開した 2. 発表の時刻 3. 短い事象の目安 4. 統計値

export const INCIDENT_ESTIMATE_BASES = ["resumed", "stated", "rule", "statistics"] as const;
export type IncidentEstimateBasis = (typeof INCIDENT_ESTIMATE_BASES)[number];

export type IncidentRemainingInput = {
  type: IncidentTypeId | null;
  // 入口で答えた原因。種類が分からないとき大分類の統計値に使う
  cause?: IncidentCause | null;
  cues: readonly AnnouncementCueId[];
  // 発表された再開見込みの時刻。無ければ null
  statedResumeTime: string | null;
  // 発生とみなした時刻
  onsetTime: string;
  now: string;
  tables?: IncidentDurationTables;
};

export type IncidentRemaining = {
  // 見込みの出どころ。見込みが無ければ null
  basis: IncidentEstimateBasis | null;
  // いまから運転再開までの残り（分）。初列車待ちを含まない
  untilResume: DurationDist | null;
  firstTrainWait: DurationDist;
  // いまから乗れるまでの残り（分）。untilResume に初列車待ちを足したもの
  remaining: DurationDist | null;
  // 確率の計算に使う再開までの標本（分、昇順）。統計値のときだけ持つ
  samples: number[] | null;
  // 統計値のとき、使った統計値
  statistics: ResolvedIncidentDuration | null;
  flowOutlook: IncidentFlowOutlook;
  // めったに無い事象で、見込みの数字を言い切らない
  withholdNumbers: boolean;
};

function addDist(a: DurationDist, b: DurationDist): DurationDist {
  return { p50: a.p50 + b.p50, p80: a.p80 + b.p80 };
}

function computeElapsedMinutes(onsetTime: string, now: string): number {
  return Math.max(0, Math.floor(diffMinutes(onsetTime, now)));
}

// 短い事象の目安から、経過を引いた残り。経過が p80 を超えていれば目安は当てはまらないので null
function computeRuleUntilResume(range: DurationDist, elapsed: number): DurationDist | null {
  if (elapsed >= range.p80) return null;
  return { p50: Math.max(0, range.p50 - elapsed), p80: range.p80 - elapsed };
}

// 統計値に使う原因。種類が分かれば種類の大分類、無ければ入口の原因
function resolveStatsCause(
  type: IncidentTypeId | null,
  cause: IncidentCause | null | undefined,
): IncidentCause | null {
  if (type) return { group: INCIDENT_TYPE_DURATIONS[type].groupId, type };
  return cause ?? null;
}

export function estimateIncidentRemaining(input: IncidentRemainingInput): IncidentRemaining {
  const { type } = input;
  const firstTrainWait = resolveFirstTrainWait(type);
  const flowOutlook = resolveFlowOutlook(type);
  const build = (
    basis: IncidentEstimateBasis | null,
    untilResume: DurationDist | null,
    extra: Partial<Pick<IncidentRemaining, "samples" | "statistics" | "withholdNumbers">> = {},
  ): IncidentRemaining => ({
    basis,
    untilResume,
    firstTrainWait,
    remaining: untilResume ? addDist(untilResume, firstTrainWait) : null,
    samples: extra.samples ?? null,
    statistics: extra.statistics ?? null,
    flowOutlook,
    withholdNumbers: extra.withholdNumbers ?? false,
  });

  if (input.cues.includes("resumed")) return build("resumed", { p50: 0, p80: 0 });
  if (input.statedResumeTime) {
    return build(
      "stated",
      estimateStatedRemainingWithoutKnowledge(input.statedResumeTime, input.now),
    );
  }
  const behavior = type ? INCIDENT_BEHAVIOR[type] : null;
  if (behavior?.rare && flowOutlook === "unknown") {
    return build(null, null, { withholdNumbers: true });
  }
  const elapsed = computeElapsedMinutes(input.onsetTime, input.now);
  const ruleUntil = behavior?.ruleRange
    ? computeRuleUntilResume(behavior.ruleRange, elapsed)
    : null;
  if (ruleUntil) return build("rule", ruleUntil);
  const cause = resolveStatsCause(type, input.cause);
  const stats = cause
    ? estimateStatsRemaining(cause, input.onsetTime, input.now, input.tables)
    : null;
  if (stats) {
    return build("statistics", stats.remaining, {
      samples: stats.samples,
      statistics: stats.resolved,
    });
  }
  return build(null, null);
}
