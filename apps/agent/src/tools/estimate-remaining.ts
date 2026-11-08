import {
  addMinutesToIso,
  checkInspectionPending,
  checkProtectionIncident,
  checkResumeAfterInspection,
  checkTrackEvacuation,
  classifyTimeOfDay,
  computeDepartureChance,
  computeHaversineMeters,
  decideRuleConfidence,
  diffMinutes,
  estimateIncidentRemaining,
  estimateQueueAfterResume,
  estimateStopReasons,
  estimateTrainQueueArrival,
  estimateUnaffectedTrackResume,
  FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
  filterCuesDuringInspection,
  findIncidentType,
  findLineOperatorKey,
  HEADWAY_MINUTES,
  type IncidentRemaining,
  type IncidentTypeId,
  normalizeTrainType,
  parseIsoToMs,
  resolveEvacuationCues,
  resolveIncidentDuration,
  resolveOperatorLineType,
  resolveStationPlatform,
  resolveTrainQueueParams,
  type StationAhead,
  sampleDurationDist,
} from "@repo/core";
import type {
  AnnouncementCueId,
  DurationDist,
  Estimate,
  EstimateSource,
  IncidentCause,
  ResumeQueue,
  Section,
  StopReasons,
} from "@repo/schema";
import { z } from "zod";
import {
  checkTrackCleared,
  checkWeatherCause,
  collectObservationCues,
  findLatestStatedResume,
  findOnsetTime,
  listObservationTexts,
  resolveObservedCause,
} from "../domain/incident.ts";
import type { EstimateToolResult, ToolContext, TrainQueueToolResult } from "./types.ts";

// 先の駅を何駅まで追うか。詰める動きで前の列車が進める範囲
const STATIONS_AHEAD_LIMIT = 4;
// 再開後の詰まりで、発表の区間まで駅を数える範囲
const QUEUE_STATIONS_LIMIT = 15;

// 新しい観測から順に、事業者を探す
function findOperator(ctx: ToolContext): string | null {
  const sorted = [...ctx.observations].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  );
  return sorted.find((o) => o.operator !== null)?.operator ?? null;
}

function findLatestLine(ctx: ToolContext): string | null {
  return ctx.observations.findLast((o) => o.line !== null)?.line ?? null;
}

function findLatestSection(ctx: ToolContext): Section | null {
  return ctx.observations.findLast((o) => o.section !== null)?.section ?? null;
}

// 駅間の車内にいる利用者が、ホームに着ける駅に着く見込み。駅間でなければ null
// 車内の人は列車を待たないので、再開までの残りを使う
// closeUpCleared は線路の安全が確かめられた兆候があるか。無ければ詰める動きを使わない
// proceedToStation は次の駅まで進むと案内されたか
function estimateTrainQueue(
  ctx: ToolContext,
  untilResume: DurationDist | null,
  closeUpCleared: boolean,
  proceedToStation: boolean,
  onsetTime: string | null,
): TrainQueueToolResult | null {
  const position = ctx.request.trainPosition;
  if (position?.kind !== "between_stations" || !position.nextStation) return null;
  const now = ctx.request.now;
  const ahead = position.previousStation
    ? ctx.provider.listStationsAhead({
        line: findLatestLine(ctx),
        previousStation: position.previousStation,
        nextStation: position.nextStation,
        limit: STATIONS_AHEAD_LIMIT,
        departureTime: now,
      })
    : null;
  const lineId = ahead?.lineId ?? null;
  const stationsAhead: StationAhead[] = (
    ahead?.stations ?? [
      {
        name: position.nextStation,
        rideMinutesFromPrevious: FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
      },
    ]
  ).map((s) => ({ ...s, platform: resolveStationPlatform(lineId, s.name) }));
  const outcome = estimateTrainQueueArrival({
    now,
    untilResume,
    ownTrainType: position.ownTrainType,
    trainsAhead: position.trainsAhead,
    trainsAheadCount: position.trainsAheadCount,
    trainsAheadHeadwayMinutes: position.trainsAheadHeadwayMinutes ?? null,
    stationsAhead,
    // 乗っている路線の事業者を先に使う。路線が引けなければ観測の事業者名を使う
    params: resolveTrainQueueParams(findLineOperatorKey(lineId) ?? findOperator(ctx)),
    closeUpCleared,
    proceedToStation,
  });
  return {
    ...outcome,
    nextStation: position.nextStation,
    ownTrainType: normalizeTrainType(position.ownTrainType),
    sequenceKnown: position.trainsAhead !== null,
    lineId,
    departureChance: outcome.departure
      ? computeDepartureChance({
          now,
          departure: outcome.departure,
          mark: outcome.arrival
            ? { time: outcome.arrival.p50, station: outcome.alightStation }
            : null,
          onsetTime,
        })
      : null,
  };
}

// 列車の中にいる利用者か。駅間でも駅の中でも、列車に乗っていれば true
function checkOnTrain(ctx: ToolContext): boolean {
  const kind = ctx.request.trainPosition?.kind;
  return kind === "between_stations" || kind === "on_train_at_station";
}

// 時間帯の同じ向きの運転間隔。詰める JR 西日本は JR の普通、それ以外は私鉄の普通で数える
function resolveHeadwayMinutes(ctx: ToolContext, operator: string | null): number {
  return HEADWAY_MINUTES[resolveOperatorLineType(operator)][classifyTimeOfDay(ctx.request.now)];
}

// 駅間の車内なら、先の駅を順にたどって発表の区間の端までの駅の数を数える。たどれなければ null
function countStationsToSection(ctx: ToolContext, section: Section): number | null {
  const position = ctx.request.trainPosition;
  if (position?.kind !== "between_stations" || !position.previousStation || !position.nextStation)
    return null;
  const ahead = ctx.provider.listStationsAhead({
    line: findLatestLine(ctx),
    previousStation: position.previousStation,
    nextStation: position.nextStation,
    limit: QUEUE_STATIONS_LIMIT,
    departureTime: ctx.request.now,
  });
  const ends = new Set([section.fromStation, section.toStation]);
  const index = ahead?.stations.findIndex((s) => ends.has(s.name)) ?? -1;
  return index >= 0 ? index : null;
}

// 利用者の位置から発表の区間の近い端までの直線距離（km）。位置か区間が引けなければ null
function measureDistanceToSection(ctx: ToolContext, section: Section): number | null {
  const position = ctx.request.trainPosition;
  const here = ctx.provider.resolvePlace(
    position?.kind === "between_stations" && position.nextStation
      ? { kind: "station", name: position.nextStation }
      : ctx.request.origin,
  );
  if (!here) return null;
  const meters = [section.fromStation, section.toStation].flatMap((name) => {
    const end = ctx.provider.resolvePlace({ kind: "station", name });
    return end ? [computeHaversineMeters(here.coord, end.coord)] : [];
  });
  return meters.length > 0 ? Math.min(...meters) / 1000 : null;
}

// 再開後の詰まり。防護無線の事象で列車の中にいるときと、詰まりの放送が聞こえたときだけ見積もる
function estimateResumeQueue(
  ctx: ToolContext,
  cues: readonly AnnouncementCueId[],
  protection: boolean,
): ResumeQueue | null {
  const announced = cues.includes("queue_ahead");
  if (!announced && !(protection && checkOnTrain(ctx))) return null;
  const operator = findOperator(ctx);
  const section = findLatestSection(ctx);
  return estimateQueueAfterResume({
    stationsBetween: section ? countStationsToSection(ctx, section) : null,
    distanceKm: section ? measureDistanceToSection(ctx, section) : null,
    headwayMinutes: resolveHeadwayMinutes(ctx, operator),
    operator,
    cues,
  });
}

// 自分の列車が止まった理由の見込み。列車の中にいる利用者のときだけ見積もる
function estimateOwnStopReasons(
  ctx: ToolContext,
  type: IncidentTypeId | null,
  cues: readonly AnnouncementCueId[],
  stoppedMinutes: number,
): StopReasons | null {
  if (!checkOnTrain(ctx)) return null;
  const operator = findOperator(ctx);
  return estimateStopReasons({
    type,
    cues,
    headwayMinutes: resolveHeadwayMinutes(ctx, operator),
    stoppedMinutes,
    operator,
    protectionBroadcast: ctx.request.protectionBroadcast ?? null,
  });
}

// 見込みの出どころ。種類が分かれば規則、分からず入口の原因の統計値があれば統計値
function decideEstimateSource(
  cause: IncidentCause | null,
  type: IncidentTypeId | null,
  incident: IncidentRemaining,
  onsetTime: string,
): EstimateSource {
  if (type) return "rule";
  if (incident.basis === "statistics") return "statistics";
  return cause && resolveIncidentDuration(cause, onsetTime) ? "statistics" : "none";
}

// 線路の安全が確かめられた兆候があるか。原文の照合に、選んで答えた再開が近い手がかりを足す
// 点検が続いている天気の事象では、cues から再開が近い手がかりを除いてあるので原文の照合を使わない
function checkCloseUpCleared(
  ctx: ToolContext,
  cues: readonly AnnouncementCueId[],
  inspectionPending: boolean,
): boolean {
  return (
    (!inspectionPending && checkTrackCleared(ctx.observations)) ||
    cues.includes("track_cleared") ||
    cues.includes("resume_soon")
  );
}

// 確率の計算に使う、乗れるまでの残りの標本。残り時間の p50・p80 と同じ根拠から作る
// 統計値は再開までの標本に初列車待ちを足す。発表の時刻はその時刻に初列車待ちを足す。再開の後は初列車待ちだけ
function sampleBoardableRemaining(incident: IncidentRemaining): number[] | null {
  const wait = incident.firstTrainWait;
  switch (incident.basis) {
    case "resumed":
      return sampleDurationDist(wait);
    case "statistics":
      return incident.samples?.map((m) => m + wait.p50) ?? null;
    case "stated":
      return incident.untilResume ? sampleDurationDist(wait, incident.untilResume.p50) : null;
    case "rule":
      return incident.remaining ? sampleDurationDist(incident.remaining) : null;
    default:
      return null;
  }
}

// 点検が終わるまで再開しない事象か。種類が分からなければ、入口で答えた原因の大分類が天気なら同じに扱う
function checkWaitsForInspection(
  type: IncidentTypeId | null,
  cause: IncidentCause | null,
): boolean {
  return checkResumeAfterInspection(type) || (type === null && cause?.group === "weather");
}

export const EstimateRemainingInputSchema = z.object({
  eventType: z
    .string()
    .nullable()
    .describe(
      "起きていることの種類の id。特定できなければ null。計算にはコードが観測と入口の原因から決めた種類を使い、違えば結果の note で知らせる",
    ),
});

export const estimateRemainingDefinition = {
  name: "estimate_remaining",
  description:
    "元指令員の経験から作った規則表と報道の統計値で、再開して乗れるまでの残り時間（p50, p80 分）をコードで計算する。運転を再開した放送、発表された再開見込みの時刻、短く終わる事象の目安、統計値の順に当てはめる（remainingBasis は resumed、stated、rule、statistics）。めったに無い事象では数字を出さない（withholdNumbers）。放送の手がかり（cues）、防護無線の事象か（protection）、支障の無い線路が先に動く見込み（unaffectedTrack）、再開後の詰まり（resumeQueue）も返す。列車の中の利用者なら、自分の列車が止まった理由ごとの割合（stopReasons）も返す。止まり方（stopScope）は、その列車から止まる train か、区間を止める section。駅間の車内なら、降りられる駅に着く見込みと自分の列車が動き出す見込み（trainQueue）も返す。",
  inputSchema: EstimateRemainingInputSchema,
} as const;

export function runEstimateRemaining(
  ctx: ToolContext,
  input: { eventType: string | null },
): EstimateToolResult {
  const now = ctx.request.now;
  const type = findIncidentType(input.eventType);
  // 発生時刻は観測から分からないので、最初の観測の時刻を発生とみなす
  const onsetTime = findOnsetTime(ctx.observations, now);
  const stated = findLatestStatedResume(ctx.observations);
  const statedIsFuture = stated !== null && parseIsoToMs(stated.time) > parseIsoToMs(now);
  const cause = resolveObservedCause(ctx.observations, ctx.request.cause ?? null);
  const inspectionPending =
    checkWaitsForInspection(type, cause) && checkInspectionPending(ctx.observations);
  // 線路に降りる案内と再開の放送が両方あれば、観測の時刻が新しいほうを使う
  const cues = resolveEvacuationCues(
    ctx.observations,
    filterCuesDuringInspection(collectObservationCues(ctx.observations), inspectionPending),
    (o) => collectObservationCues([o]),
  );
  const evacuation = checkTrackEvacuation(cues);
  const incident = estimateIncidentRemaining({
    type,
    cause,
    cues,
    statedResumeTime: stated && statedIsFuture ? stated.time : null,
    onsetTime,
    now,
    // 台風のように長さの見込みを上げる語を見る
    texts: listObservationTexts(ctx.observations),
  });
  const elapsed = Math.max(0, Math.floor(diffMinutes(onsetTime, now)));
  const protection = checkProtectionIncident({
    type,
    cues,
    protectionBroadcast: ctx.request.protectionBroadcast ?? null,
  });
  const remaining = incident.remaining;
  const estimate: Estimate = {
    eventType: type,
    phaseId: null,
    elapsedMinutes: elapsed,
    remaining,
    confidence: decideRuleConfidence({
      type,
      basis: incident.basis,
      cues,
      statedExtended: stated?.extended ?? false,
    }),
    source: decideEstimateSource(cause, type, incident, onsetTime),
  };
  return {
    estimate,
    // 線路に降りる案内が出たら、駅に着く時刻も再開の時刻も出さない
    trainQueue: evacuation
      ? null
      : estimateTrainQueue(
          ctx,
          incident.untilResume,
          checkCloseUpCleared(ctx, cues, inspectionPending),
          cues.includes("proceed_to_station"),
          onsetTime,
        ),
    statedResumeTime: stated?.time ?? null,
    statedExtended: stated?.extended ?? false,
    remainingBasis: incident.basis,
    firstTrainWait: incident.firstTrainWait,
    boardableP50: remaining ? addMinutesToIso(now, remaining.p50) : null,
    boardableP80: remaining ? addMinutesToIso(now, remaining.p80) : null,
    flowOutlook: incident.flowOutlook,
    withholdNumbers: incident.withholdNumbers,
    weatherIncident: checkWeatherCause(type, cause),
    cues,
    protection,
    unaffectedTrack: evacuation
      ? null
      : estimateUnaffectedTrackResume({
          protection,
          trackSide: "unknown",
          affectedUntilResume: incident.untilResume,
          elapsedSinceOnsetMinutes: elapsed,
        }),
    resumeQueue: evacuation ? null : estimateResumeQueue(ctx, cues, protection),
    stopReasons: estimateOwnStopReasons(ctx, type, cues, elapsed),
    remainingSamples: sampleBoardableRemaining(incident),
    onsetTime,
  };
}
