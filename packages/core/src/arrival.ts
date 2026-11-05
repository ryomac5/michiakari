import type { RouteLeg } from "@repo/schema";
import { addMinutesToIso } from "./time.ts";

// 経路の分数の和から到着時刻を求める

export type LegMinutes = Pick<RouteLeg, "minutes">;

// 区間の分数を合計する
export function sumLegMinutes(legs: readonly LegMinutes[]): number {
  let total = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.minutes) || leg.minutes < 0) {
      throw new RangeError(`区間の分数は 0 以上の有限値: ${leg.minutes}`);
    }
    total += leg.minutes;
  }
  return total;
}

// 出発時刻に区間の分数の和を足した到着時刻（+09:00）を返す
export function computeArrival(departureIso: string, legs: readonly LegMinutes[]): string {
  return addMinutesToIso(departureIso, sumLegMinutes(legs));
}
