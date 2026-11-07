import { STOP_REASONS, type StopReason, type StopReasons } from "@repo/schema";
import type { AnnouncementCueId } from "../params/announcement-cues.ts";
import { INCIDENT_BEHAVIOR } from "../params/incident-behavior.ts";
import type { IncidentTypeId } from "../params/incident-durations.ts";
import {
  DISPATCH_RADIUS_KM,
  NO_OWN_TRAIN_EXTRA_TYPES,
  PROTECTION_RADIUS_KM,
  QUEUE_AHEAD_CUE_WEIGHT,
  STOP_REASON_TIE_ORDER,
} from "../params/stop-reasons.ts";
import { type LineType, SCHEDULED_SPEED_KMH } from "../params/transit.ts";
import { checkProtectionIncident, checkWeatherIncident } from "./incident-rules.ts";
import { normalizeOperatorKey } from "./train-queue.ts";

// 電車の中で止まった利用者の列車が、なぜ止まったかの見込み
// 理由ごとに止まる列車の本数を見積もり、その比を割合とする。利用者は止まった列車のどれかに乗っているとみなす
// 当該列車は 1 本なので、当該の割合は 1 ÷ 止まった本数の合計になる

export type StopReasonsInput = {
  type: IncidentTypeId | null;
  cues: readonly AnnouncementCueId[];
  // 時間帯の同じ向きの運転間隔（分）
  headwayMinutes: number;
  // 止まってからの分
  stoppedMinutes: number;
  // 事業者名か事業者キー。速度の目安を選ぶ
  operator: string | null;
};

type ReasonCounts = Record<StopReason, number>;

// 詰める JR 西日本は JR の普通、それ以外は私鉄の普通として路線の種別を選ぶ
export function resolveOperatorLineType(operator: string | null): LineType {
  return normalizeOperatorKey(operator) === "jr-west" ? "jr_local" : "private_local";
}

// 上下の線路で、長さ km の範囲にいる列車の本数。列車の間隔は 運転間隔 × 速度
function countTrainsInStretch(km: number, headwayMinutes: number, lineType: LineType): number {
  const spacingKm = (headwayMinutes * SCHEDULED_SPEED_KMH[lineType]) / 60;
  return (2 * km) / spacingKm;
}

function checkOwnTrainIncident(type: IncidentTypeId | null): boolean {
  if (type === null) return true;
  return !checkWeatherIncident(type) && !NO_OWN_TRAIN_EXTRA_TYPES.includes(type);
}

// 止まってからの分。有限でない値と負の値は 0 とする
function normalizeStoppedMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

// 理由ごとに止まる列車の本数。手がかりで確定させる前の値
export function countStopReasonTrains(input: StopReasonsInput): ReasonCounts {
  const lineType = resolveOperatorLineType(input.operator);
  const protection = checkProtectionIncident({ type: input.type, cues: input.cues });
  const own = checkOwnTrainIncident(input.type) ? 1 : 0;
  const stopKind = input.type ? INCIDENT_BEHAVIOR[input.type].stopKind : "section";
  // 発生場所の前後 1km の上下の列車
  const received = protection
    ? countTrainsInStretch(2 * PROTECTION_RADIUS_KM, input.headwayMinutes, lineType)
    : 0;
  // 区間を止める事象と防護無線の事象では、指令が止める範囲の上下の列車。受信で止まった列車は引く
  const section =
    protection || stopKind === "section"
      ? countTrainsInStretch(2 * DISPATCH_RADIUS_KM, input.headwayMinutes, lineType)
      : 0;
  return {
    own_incident: own,
    protection_received: received,
    dispatcher_order: Math.max(0, section - received),
    // 当該の後ろに、止まってから来た列車。天気と停電は指令が区間ごと止めるので、後ろの列車も指令の指示に数える
    queued_behind:
      own > 0 ? normalizeStoppedMinutes(input.stoppedMinutes) / input.headwayMinutes : 0,
  };
}

// 手がかりで重みを変える。受信が聞こえれば防護無線に確定し、詰まりの放送なら詰まりを大きく上げる
function weighCountsByCues(counts: ReasonCounts, cues: readonly AnnouncementCueId[]): ReasonCounts {
  if (cues.includes("protection_received")) {
    return { own_incident: 0, protection_received: 1, dispatcher_order: 0, queued_behind: 0 };
  }
  if (cues.includes("queue_ahead")) {
    return {
      ...counts,
      queued_behind: Math.max(1, counts.queued_behind) * QUEUE_AHEAD_CUE_WEIGHT,
    };
  }
  return counts;
}

const roundTo = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const SHARE_UNITS = 100;

// 割合を 100 分の 1 に丸める。最大剰余法で、丸めた後の合計をちょうど 1 にする
function roundSharesToTotal(weights: ReasonCounts, total: number): ReasonCounts {
  const exact = STOP_REASONS.map((r) => ({ r, units: (weights[r] / total) * SHARE_UNITS }));
  const floored = exact.map((e) => ({ ...e, whole: Math.floor(e.units) }));
  let left = SHARE_UNITS - floored.reduce((sum, e) => sum + e.whole, 0);
  const byRemainder = [...floored].sort((a, b) => b.units - b.whole - (a.units - a.whole));
  const units = new Map(floored.map((e) => [e.r, e.whole]));
  for (const e of byRemainder) {
    if (left <= 0) break;
    units.set(e.r, e.whole + 1);
    left -= 1;
  }
  return Object.fromEntries(
    STOP_REASONS.map((r) => [r, (units.get(r) ?? 0) / SHARE_UNITS]),
  ) as ReasonCounts;
}

// 割合を 100 分の 1、本数を 1 桁に丸めて返す。種類も決め手の手がかりも無ければ null
export function estimateStopReasons(input: StopReasonsInput): StopReasons | null {
  if (!Number.isFinite(input.headwayMinutes) || input.headwayMinutes <= 0) {
    throw new RangeError(`運転間隔は正の値: ${input.headwayMinutes}`);
  }
  const decisiveCue = input.cues.some((c) => c === "protection_received" || c === "queue_ahead");
  if (input.type === null && !decisiveCue) return null;
  const counts = countStopReasonTrains(input);
  const weights = weighCountsByCues(counts, input.cues);
  const total = STOP_REASONS.reduce((sum, r) => sum + weights[r], 0);
  if (total <= 0) return null;
  // 同じ割合なら、受信、指令の指示、詰まり、当該の順に選ぶ
  const mostLikely = STOP_REASON_TIE_ORDER.reduce((best, r) =>
    weights[r] > weights[best] ? r : best,
  );
  const map = (f: (r: StopReason) => number) =>
    Object.fromEntries(STOP_REASONS.map((r) => [r, f(r)])) as ReasonCounts;
  return {
    shares: roundSharesToTotal(weights, total),
    mostLikely,
    trainCounts: map((r) => roundTo(counts[r], 1)),
  };
}
