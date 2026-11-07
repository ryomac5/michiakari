import {
  type BreakEvenResult,
  type ComparisonRow,
  compareOptions,
  computeBreakEven,
} from "@repo/core";
import type { DurationDist, RouteOption } from "@repo/schema";

// core の分岐点計算への入口。分岐点の時刻は運転再開の期限

export type BreakEvenComputation = {
  result: BreakEvenResult;
  comparison: ComparisonRow[];
  // 分岐点の計算に使った代替手段。core が勧める代替手段と同じ
  basisOptionIds: string[];
};

export type BreakEvenRequest = {
  now: string;
  remaining: DurationDist | null;
  waitRouteMinutesAfterResume: number;
  options: readonly RouteOption[];
  deadline: string | null;
  // 規則表の初列車待ちの p50。分からなければ null
  firstTrainWaitMinutes: number | null;
  // 勧める代替手段の候補から外す選択肢。防護無線の事象で下げた同じ会社の線。比較表には残す
  excludedOptionIds?: readonly string[];
};

// 外す選択肢を除いた候補。外すと代替手段が無くなるなら外さない
function selectCandidates(
  alternatives: readonly RouteOption[],
  excluded: readonly string[],
): RouteOption[] {
  const kept = alternatives.filter((o) => !excluded.includes(o.id));
  return kept.length > 0 ? kept : [...alternatives];
}

// 勧める代替手段は core が決める。分岐点はその到着時刻で求め、比較表には待つ以外の選択肢をすべて並べる
export function computeBreakEvenForOptions(request: BreakEvenRequest): BreakEvenComputation {
  const base = {
    now: request.now,
    remaining: request.remaining,
    waitRouteMinutesAfterResume: request.waitRouteMinutesAfterResume,
    firstTrainWaitMinutes: request.firstTrainWaitMinutes ?? 0,
    alternatives: request.options.filter((o) => o.kind !== "wait"),
    deadline: request.deadline,
  };
  const result = computeBreakEven({
    ...base,
    alternatives: selectCandidates(base.alternatives, request.excludedOptionIds ?? []),
  });
  const comparison = compareOptions({ ...base, waitOptionId: "wait" });
  return {
    result,
    comparison,
    basisOptionIds: result.kind === "no_alternative" ? [] : [result.bestAlternativeId],
  };
}
