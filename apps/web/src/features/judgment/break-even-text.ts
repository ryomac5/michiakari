import { formatClockTime } from "./time";

// 分岐点の説明文から分岐点の時刻を探し、その前後に分ける。時刻は画面の表記（21:40）にそろえて強調する

export type ClockSplit = { before: string; clock: string; after: string };

function listClockSpellings(clock: string): string[] {
  const [hh = "", mm = ""] = clock.split(":");
  const h = String(Number(hh));
  const m = String(Number(mm));
  return [`${hh}:${mm}`, `${h}:${mm}`, `${hh}時${mm}分`, `${h}時${mm}分`, `${h}時${m}分`];
}

export function splitAroundClock(text: string, timeIso: string, locale: string): ClockSplit | null {
  const clock = formatClockTime(timeIso, locale);
  let best: { index: number; spelling: string } | null = null;
  for (const spelling of listClockSpellings(clock)) {
    const index = text.indexOf(spelling);
    if (
      index !== -1 &&
      (best === null ||
        index < best.index ||
        (spelling.length > best.spelling.length && index === best.index))
    ) {
      best = { index, spelling };
    }
  }
  if (best === null) return null;
  return {
    before: text.slice(0, best.index),
    clock,
    after: text.slice(best.index + best.spelling.length),
  };
}
