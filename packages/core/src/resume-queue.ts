import type { AnnouncementCueId } from "../params/announcement-cues.ts";
import {
  AVERAGE_STATION_SPACING_KM,
  QUEUE_ALIGHT_WORTH_MINUTES,
} from "../params/incident-behavior.ts";
import {
  FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
  MIN_MINUTES_PER_TRAIN_AHEAD,
} from "../params/train-queue.ts";
import { resolveTrainQueueParams } from "./train-queue.ts";

// 大きな事故で再開した後、先の列車が詰まって先へ進めない見込み
// 次の駅までは行かせてもらえる。その駅で降りて乗り換えるのが早いことがある

export type ResumeQueueInput = {
  // 利用者と発表の発生場所の間の駅の数。分からなければ null
  stationsBetween: number | null;
  // 駅の数が分からないときの、利用者と発生場所の間の距離（km）
  distanceKm?: number | null;
  // 時間帯の同じ向きの運転間隔（分）
  headwayMinutes: number;
  // 事業者名か事業者キー
  operator: string | null;
  cues: readonly AnnouncementCueId[];
};

export type ResumeQueueOutlook = {
  // 事業者が駅間の列車を詰めるか。詰めない事業者では列の見積もりを出さない
  closesUp: boolean;
  // 自分の前に詰まる列車の本数
  trainsInQueue: number;
  // 自分の番が来るまでの分の範囲。詰めない事業者なら null
  waitRange: { minMinutes: number; maxMinutes: number } | null;
  // 詰まりの放送が聞こえたか
  queueAnnounced: boolean;
  // 次の駅で降りて別の手段に乗り換える価値があるか
  worthAlightingAtNextStation: boolean;
};

function resolveStationsBetween(input: ResumeQueueInput): number {
  if (input.stationsBetween !== null) return Math.max(0, input.stationsBetween);
  if (input.distanceKm != null) {
    return Math.max(0, Math.round(input.distanceKm / AVERAGE_STATION_SPACING_KM));
  }
  return 0;
}

// 間の駅の数を走る分を運転間隔で割り、その間を走っていた列車の本数とする
function countQueuedTrains(stations: number, headwayMinutes: number, announced: boolean): number {
  const counted = Math.floor((stations * FALLBACK_RIDE_MINUTES_TO_NEXT_STATION) / headwayMinutes);
  return announced ? Math.max(1, counted) : counted;
}

export function estimateQueueAfterResume(input: ResumeQueueInput): ResumeQueueOutlook {
  if (!Number.isFinite(input.headwayMinutes) || input.headwayMinutes <= 0) {
    throw new RangeError(`運転間隔は正の値: ${input.headwayMinutes}`);
  }
  const params = resolveTrainQueueParams(input.operator);
  const queueAnnounced = input.cues.includes("queue_ahead");
  const trainsInQueue = countQueuedTrains(
    resolveStationsBetween(input),
    input.headwayMinutes,
    queueAnnounced,
  );
  if (!params.closesUp) {
    return {
      closesUp: false,
      trainsInQueue,
      waitRange: null,
      queueAnnounced,
      worthAlightingAtNextStation: false,
    };
  }
  const waitRange = {
    minMinutes: trainsInQueue * MIN_MINUTES_PER_TRAIN_AHEAD,
    maxMinutes: trainsInQueue * params.minutesPerTrainAhead.p80,
  };
  return {
    closesUp: true,
    trainsInQueue,
    waitRange,
    queueAnnounced,
    worthAlightingAtNextStation:
      trainsInQueue > 0 && (queueAnnounced || waitRange.maxMinutes >= QUEUE_ALIGHT_WORTH_MINUTES),
  };
}
