import type { DurationDist } from "@repo/schema";
import { STATED_RESUME_SLACK_MINUTES } from "../params/estimation.ts";
import { diffMinutes } from "./time.ts";

// 発表された再開見込みの時刻からの残り時間

// 発表された再開見込み時刻までの分（切り上げ、0 以上）
function computeMinutesUntilStated(statedResumeTime: string, now: string): number {
  return Math.max(0, Math.ceil(diffMinutes(now, statedResumeTime)));
}

// 発表された再開見込み時刻からの残り時間。初列車待ちを含まない
// p50 は発表の時刻どおり、p80 は STATED_RESUME_SLACK_MINUTES だけ延びる余地を持たせる
export function estimateStatedRemainingWithoutKnowledge(
  statedResumeTime: string,
  now: string,
): DurationDist {
  const untilResume = computeMinutesUntilStated(statedResumeTime, now);
  return { p50: untilResume, p80: untilResume + STATED_RESUME_SLACK_MINUTES };
}
