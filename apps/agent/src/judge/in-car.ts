import { selectAfterAlightStep } from "@repo/core";
import type { AfterAlightStep, InCarGuide, JudgeRequest, Lang, RouteOption } from "@repo/schema";
import type { EstimateToolResult } from "../tools/types.ts";
import type { JudgmentToolResults } from "./assemble.ts";
import { buildAfterAlightText, buildStaffNote, type TrainQueueText } from "./templates.ts";

// 駅間の車内の人への案内。結論は車内で待つだけにし、切り替えはいまの選択肢として示さない
// 決定論モードと claude モードが同じ案内を付ける

// 駅間の車内の人か。次の駅が分かっているときだけ、着く見込みを出せる
export function checkInCarBetweenStations(request: JudgeRequest): boolean {
  const position = request.trainPosition;
  return position?.kind === "between_stations" && position.nextStation !== null;
}

// 駅間の車内の文の材料。駅間でなければ null
export function buildTrainQueueText(estimate: EstimateToolResult): TrainQueueText | null {
  const queue = estimate.trainQueue;
  if (!queue) return null;
  return {
    alightStation: queue.alightStation,
    arrivalP50: queue.arrival?.p50 ?? null,
    departureP50: queue.departure?.p50 ?? null,
    beforeResume: queue.beforeResume,
    trainsAheadCount: queue.trainsAheadCount,
    spacedByHeadway: queue.spacedByHeadway,
    ownTrainType: queue.ownTrainType,
    delays: queue.delays,
  };
}

// 選択肢から、着いた後の次の一手を作る。乗る路線と駅は最初の乗車から取る
function buildAfterAlightStep(
  alightStation: string,
  option: RouteOption,
  language: Lang,
): AfterAlightStep | null {
  if (option.kind === "wait") return null;
  const ride = option.legs.find((leg) => leg.mode === "ride");
  const line = option.kind === "transfer" ? (ride?.line ?? null) : null;
  const boardStation = option.kind === "transfer" ? (ride?.from ?? null) : null;
  return {
    kind: option.kind,
    text: buildAfterAlightText(alightStation, { kind: option.kind, line, boardStation }, language),
    line,
    boardStation,
    arrivalTime: option.arrivalTime,
  };
}

// 判断に付ける車内の案内。駅間でなければ null
export function buildInCarGuide(
  request: JudgeRequest,
  results: JudgmentToolResults,
): InCarGuide | null {
  const queue = results.estimate.trainQueue;
  if (!queue || !checkInCarBetweenStations(request)) return null;
  const language = request.language;
  const options = results.alternatives.options;
  const step = selectAfterAlightStep({
    alightStation: queue.alightStation,
    departureStation: request.origin.kind === "station" ? request.origin.name : null,
    destinationStation: request.destination.kind === "station" ? request.destination.name : null,
    waitOption: options.find((o) => o.id === results.alternatives.waitOptionId) ?? null,
    options,
  });
  return {
    alightStation: queue.alightStation,
    alightArrival: queue.arrival?.p50 ?? null,
    departure: queue.departure?.p50 ?? null,
    afterAlight: step ? buildAfterAlightStep(queue.alightStation, step, language) : null,
    staffNote: buildStaffNote(language),
  };
}
