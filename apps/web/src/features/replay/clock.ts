import type { TimelineEntry } from "@repo/schema";

// 再生の時間軸。シナリオ開始からの経過分（小数）で持つ。1x はシナリオの 1 分を実時間 1 秒で進める

export const speedChoices = [1, 2, 4] as const;
export const defaultSpeed = 1;
// テストと録画のためにクエリで上げられる上限
export const maxSpeed = 600;
// この速度以下では推論の過程が目で追えるよう、イベントの間を空ける
export const pacedSpeedLimit = 4;
export const eventGapMs = 320;

// ?speed= の値を再生速度に解決する。不正な値は null
export function resolveSpeedParam(value: string | undefined | null): number | null {
  if (!value) return null;
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.min(speed, maxSpeed);
}

export type ClockStep =
  | { kind: "advance"; clockMinutes: number }
  | { kind: "input"; clockMinutes: number; index: number }
  | { kind: "end"; clockMinutes: number };

// elapsedMs だけ時計を進める。次の観測の時刻に届いたら、その時刻で止めて入力を指示する
export function advanceReplayClock(
  timeline: readonly TimelineEntry[],
  nextIndex: number,
  clockMinutes: number,
  elapsedMs: number,
  speed: number,
): ClockStep {
  const next = timeline[nextIndex];
  if (!next) return { kind: "end", clockMinutes };
  const advanced = clockMinutes + (Math.max(0, elapsedMs) / 1000) * speed;
  if (advanced >= next.offset_minutes) {
    return { kind: "input", clockMinutes: next.offset_minutes, index: nextIndex };
  }
  return { kind: "advance", clockMinutes: advanced };
}

// 再生バーの位置（0〜1）。最後の観測の時刻を終端とする
export function computeReplayProgress(
  timeline: readonly TimelineEntry[],
  clockMinutes: number,
): number {
  const end = timeline.at(-1)?.offset_minutes ?? 0;
  if (end <= 0) return timeline.length > 0 && clockMinutes >= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, clockMinutes / end));
}

export function computeEventGapMs(speed: number): number {
  return speed <= pacedSpeedLimit ? eventGapMs : 0;
}
