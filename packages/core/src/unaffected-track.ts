import type { DurationDist, TrackSide } from "@repo/schema";
import { UNAFFECTED_TRACK_RESUME } from "../params/incident-behavior.ts";

// 防護無線の事象で、支障の無い線路が先に動き出す見込み
// 指令は範囲を確かめ、支障の無い線路から順に動かす。当該の線路は長く止まる

// 利用者がいる線路の定義は packages/schema が唯一の正
export { TRACK_SIDES, type TrackSide } from "@repo/schema";

export type UnaffectedTrackInput = {
  // checkProtectionIncident の結果
  protection: boolean;
  trackSide: TrackSide;
  // 当該の線路の再開までの残り（分）。estimateIncidentRemaining の untilResume。無ければ null
  affectedUntilResume: DurationDist | null;
  // 発生とみなした時刻からの経過（分）
  elapsedSinceOnsetMinutes: number;
};

export type UnaffectedTrackOutlook = {
  trackSide: TrackSide;
  // 当該の線路の再開までの残り。当該の線路にいないと分かれば null
  affected: DurationDist | null;
  // 反対の線路の再開までの残り。当該の線路にいると分かれば null
  opposite: DurationDist | null;
};

function computeOppositeRemaining(elapsed: number): DurationDist {
  return {
    p50: Math.max(0, UNAFFECTED_TRACK_RESUME.p50 - elapsed),
    p80: Math.max(0, UNAFFECTED_TRACK_RESUME.p80 - elapsed),
  };
}

// 防護無線の事象でなければ null。分からなければ両方の見込みを返す
export function estimateUnaffectedTrackResume(
  input: UnaffectedTrackInput,
): UnaffectedTrackOutlook | null {
  if (!input.protection) return null;
  const elapsed = Math.max(0, input.elapsedSinceOnsetMinutes);
  return {
    trackSide: input.trackSide,
    affected: input.trackSide === "opposite" ? null : input.affectedUntilResume,
    opposite: input.trackSide === "affected" ? null : computeOppositeRemaining(elapsed),
  };
}
