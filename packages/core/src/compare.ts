import {
  type BreakEvenInput,
  checkDeadline,
  computeWaitArrival,
  type DeadlineCheck,
} from "./break-even.ts";
import { formatJstIso, parseIsoToMs } from "./time.ts";

// 待つ場合と各代替手段の到着時刻を早い順に並べた比較表

export type ComparisonScenario = "wait_p50" | "wait_p80" | "alternative";

export type ComparisonRow = {
  optionId: string;
  scenario: ComparisonScenario;
  arrivalTime: string;
  minutesFromNow: number;
  // 期限がなければ null
  deadline: DeadlineCheck | null;
};

export type CompareOptionsInput = BreakEvenInput & {
  deadline: string | null;
  // 待つ場合の行に付ける ID。既定は "wait"
  waitOptionId?: string;
};

// 比較表の行を作る
function buildRow(
  input: CompareOptionsInput,
  optionId: string,
  scenario: ComparisonScenario,
  arrivalTime: string,
): ComparisonRow {
  const arrivalMs = parseIsoToMs(arrivalTime);
  return {
    optionId,
    scenario,
    arrivalTime: formatJstIso(arrivalMs),
    minutesFromNow: Math.round((arrivalMs - parseIsoToMs(input.now)) / 60_000),
    deadline: input.deadline === null ? null : checkDeadline(arrivalTime, input.deadline),
  };
}

// 待つ場合（p50・p80）と各代替手段を到着の早い順に並べる。同着は入力順（待つ場合が先）
export function compareOptions(input: CompareOptionsInput): ComparisonRow[] {
  const waitId = input.waitOptionId ?? "wait";
  const rows: ComparisonRow[] = [];
  if (input.remaining !== null) {
    const { p50, p80 } = input.remaining;
    const minutes = input.waitRouteMinutesAfterResume;
    rows.push(buildRow(input, waitId, "wait_p50", computeWaitArrival(input.now, p50, minutes)));
    rows.push(buildRow(input, waitId, "wait_p80", computeWaitArrival(input.now, p80, minutes)));
  }
  for (const alt of input.alternatives) {
    rows.push(buildRow(input, alt.id, "alternative", alt.arrivalTime));
  }
  return rows.sort((a, b) => parseIsoToMs(a.arrivalTime) - parseIsoToMs(b.arrivalTime));
}
