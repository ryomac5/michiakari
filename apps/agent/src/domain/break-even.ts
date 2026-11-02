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
  // 分岐点の計算に使った代替手段
  basisOptionIds: string[];
};

export type BreakEvenRequest = {
  now: string;
  remaining: DurationDist | null;
  waitRouteMinutesAfterResume: number;
  options: readonly RouteOption[];
  deadline: string | null;
  // 知見の after_resume.first_train_wait_minutes.p50。事象が不明なら null
  firstTrainWaitMinutes: number | null;
};

// 公共交通の代替があればそれだけで、無ければタクシーで分岐点を求める。タクシーは費用が大きいため
export function selectBreakEvenBasis(options: readonly RouteOption[]): RouteOption[] {
  const publicOptions = options.filter((o) => o.kind === "transfer" || o.kind === "walk");
  return publicOptions.length > 0 ? publicOptions : options.filter((o) => o.kind === "taxi");
}

export function computeBreakEvenForOptions(request: BreakEvenRequest): BreakEvenComputation {
  const basis = selectBreakEvenBasis(request.options);
  const base = {
    now: request.now,
    remaining: request.remaining,
    waitRouteMinutesAfterResume: request.waitRouteMinutesAfterResume,
    firstTrainWaitMinutes: request.firstTrainWaitMinutes ?? 0,
  };
  const result = computeBreakEven({ ...base, alternatives: basis });
  const comparison = compareOptions({
    ...base,
    alternatives: request.options.filter((o) => o.kind !== "wait"),
    deadline: request.deadline,
    waitOptionId: "wait",
  });
  return { result, comparison, basisOptionIds: basis.map((o) => o.id) };
}
