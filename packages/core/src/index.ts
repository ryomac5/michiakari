// 決定論的な計算。Claude を呼ばない

export {
  ANNOUNCEMENT_CUE_IDS,
  ANNOUNCEMENT_CUE_PATTERNS,
  type AnnouncementCueId,
} from "../params/announcement-cues.ts";
export {
  COMMUTE_HOUR_RANGES,
  MONTE_CARLO_SAMPLE_COUNT,
  MONTE_CARLO_SEED,
  STATED_RESUME_SLACK_MINUTES,
} from "../params/estimation.ts";
export {
  FIRST_TRAIN_WAIT_BY_STOP_KIND,
  INCIDENT_BEHAVIOR,
  INCIDENT_BEHAVIOR_SOURCE,
  INCIDENT_FLOW_OUTLOOKS,
  type IncidentBehavior,
  type IncidentFlowOutlook,
  PROTECTION_LEVELS,
  type ProtectionLevel,
  STOP_KINDS,
  UNAFFECTED_TRACK_RESUME,
} from "../params/incident-behavior.ts";
export {
  type DurationPeriod,
  INCIDENT_GROUP_IDS,
  INCIDENT_TYPE_IDS,
  type IncidentGroupId,
  type IncidentTypeId,
} from "../params/incident-durations.ts";
export { INCIDENT_PHRASES } from "../params/incident-phrases.ts";
export * from "../params/routing.ts";
export {
  DISPATCH_RADIUS_KM,
  PROTECTION_RADIUS_KM,
  QUEUE_AHEAD_CUE_WEIGHT,
  STOP_REASON_TIE_ORDER,
  STOP_REASONS_SOURCE,
} from "../params/stop-reasons.ts";
export {
  OSAKA_CITY_TAXI_FARE,
  OSAKA_CITY_TAXI_FARE_LABEL,
  OSAKA_CITY_TAXI_FARE_SOURCES,
  TAXI_TRIP_PARAMS_SOURCE,
  type TaxiFareSource,
} from "../params/taxi.ts";
export {
  ALL_TRAIN_TYPES,
  DEFAULT_STATION_PLATFORM,
  DEFAULT_TRAIN_QUEUE_PARAMS,
  FALLBACK_RIDE_MINUTES_TO_NEXT_STATION,
  type LineOperationPattern,
  MIN_MINUTES_PER_TRAIN_AHEAD,
  OPERATION_PATTERNS,
  type OperationPattern,
  STATION_PLATFORMS_BY_LINE,
  type StationPlatform,
  TRAIN_QUEUE_PARAMS_BY_OPERATOR,
  TRAIN_QUEUE_PARAMS_SOURCE,
  TRAINS_AHEAD_COUNT,
  type TrainQueueParams,
} from "../params/train-queue.ts";
export {
  KANSAI_COMMON_TRANSFER_OPERATORS,
  TICKET_TRANSFER_ELIGIBLE,
  TRANSFER_FARE_SOURCES,
} from "../params/transfer-fare.ts";
export {
  HEADWAY_MINUTES,
  LINE_TYPES,
  type LineType,
  TIMES_OF_DAY,
  type TimeOfDay,
  TRANSIT_PARAMS_SOURCE,
} from "../params/transit.ts";
export { WALK_PARAMS_SOURCE } from "../params/walk.ts";
export {
  type AfterAlightDecision,
  type AfterAlightInput,
  type AfterAlightReason,
  classifyStayOn,
  decideAfterAlightStep,
  type StayOn,
  selectAfterAlightStep,
} from "./after-alight.ts";
export {
  ALTERNATIVE_STANDINGS,
  type AlternativeStanding,
  type ProtectionRankingInput,
  type RankableAlternative,
  type RankedAlternative,
  rankAlternativesForProtection,
} from "./alternative-ranking.ts";
export {
  checkInspectionPending,
  checkTrackCleared,
  detectAnnouncementCues,
  detectObservationCues,
  filterCuesDuringInspection,
} from "./announcement-cues.ts";
export { computeArrival, type LegMinutes, sumLegMinutes } from "./arrival.ts";
export {
  type AlternativeArrival,
  type AlternativeChoice,
  type AlternativeChoiceReason,
  type BreakEvenInput,
  type BreakEvenResult,
  checkDeadline,
  chooseBestAlternative,
  computeBreakEven,
  computeInCarWaitArrival,
  computeLateShare,
  computeWaitArrival,
  convertToBreakEven,
  type DeadlineCheck,
  type ResumeOutlook,
  selectBestAlternative,
} from "./break-even.ts";
export {
  type CompareOptionsInput,
  type ComparisonRow,
  type ComparisonScenario,
  compareOptions,
} from "./compare.ts";
export {
  type DurationModel,
  fitDurationModel,
  sampleDuration,
  sampleRemainingDuration,
} from "./duration-model.ts";
export {
  estimateIncidentRemaining,
  INCIDENT_ESTIMATE_BASES,
  type IncidentEstimateBasis,
  type IncidentRemaining,
  type IncidentRemainingInput,
} from "./incident-estimate.ts";
export {
  checkProtectionIncident,
  checkResumeAfterInspection,
  checkTrackEvacuation,
  checkWeatherIncident,
  decideRuleConfidence,
  findIncidentTypeByPhrase,
  type IncidentTypeInput,
  type ProtectionIncidentInput,
  type RuleConfidenceInput,
  resolveFirstTrainWait,
  resolveFlowOutlook,
  resolveIncidentType,
} from "./incident-rules.ts";
export {
  classifyDurationPeriod,
  estimateStatsRemaining,
  type IncidentDurationTables,
  type ResolvedIncidentDuration,
  resolveIncidentDuration,
  type StatsRemaining,
  sampleStatsRemaining,
} from "./incident-stats.ts";
export {
  compareReplayOutcome,
  OUTCOME_SMALL_DIFF_MINUTES,
  type OutcomeTraveler,
  type ReplayDecision,
  type ReplayOutcome,
  type ReplayOutcomeInput,
  type ReplayOutcomeVerdict,
} from "./outcome.ts";
export { createMulberry32, type Random } from "./random.ts";
export { computeQuantile, sampleDurationDist, summarizeSamples } from "./remaining.ts";
export { estimateStatedRemainingWithoutKnowledge } from "./remaining-paths.ts";
export {
  CHANCE_FLOOR,
  CHANCE_NEARLY_CERTAIN,
  CHANCE_TICK_COUNT,
  CHANCE_TICK_END_QUANTILE,
  CHANCE_TICK_STEPS_MINUTES,
  computeChanceWithin,
  computeMovingProbability,
  computeResumeChance,
  computeWaitFasterProbability,
  computeWaitOnTimeProbability,
  listChanceTickTimes,
  type ResumeChanceInput,
  roundChanceTenths,
  selectKeyTick,
} from "./resume-chance.ts";
export {
  estimateQueueAfterResume,
  type ResumeQueueInput,
  type ResumeQueueOutlook,
} from "./resume-queue.ts";
export {
  countStopReasonTrains,
  estimateStopReasons,
  resolveOperatorLineType,
  type StopReasonsInput,
} from "./stop-reasons.ts";
export {
  findIncidentType,
  INCIDENT_TYPE_BY_EVENT_TYPE,
  type ObservedStopScopeInput,
  resolveObservedStopScope,
  resolveStopKind,
  resolveStopScope,
  STOP_KIND_BY_INCIDENT_TYPE,
  type StopKind,
  type StopScope,
  type StopScopeInput,
  selectObservedEventType,
} from "./stop-scope.ts";
export {
  checkNightSurcharge,
  computeTaxiFare,
  computeTaxiMinutes,
  estimateTaxiRoadKm,
  type TaxiFare,
} from "./taxi.ts";
export {
  addMinutesToIso,
  diffMinutes,
  formatJstIso,
  getJstMinuteOfDay,
  parseIsoToMs,
} from "./time.ts";
export {
  type ConcreteTrainType,
  computeTrackHeadwayMinutes,
  countTrainsAhead,
  estimateTrainQueueArrival,
  findLineOperatorKey,
  findOperationPattern,
  inferDefaultOwnTrainType,
  inferTrainsAheadFromPattern,
  normalizeOperatorKey,
  normalizeTrainType,
  resolveStationPlatform,
  resolveTrainQueueParams,
  type StationAhead,
  type TrainQueueDelay,
  type TrainQueueInput,
  type TrainQueueOutcome,
} from "./train-queue.ts";
export {
  type ApplyTransferFaresInput,
  applyTransferFares,
  decideTransferFare,
  findOperatorKeysInText,
  resolveLineOperator,
  type TransferFareInput,
} from "./transfer-fare.ts";
export {
  classifyTimeOfDay,
  computeRideMinutes,
  computeRideMinutesUnrounded,
  computeWaitMinutes,
} from "./transit.ts";
export {
  estimateUnaffectedTrackResume,
  TRACK_SIDES,
  type TrackSide,
  type UnaffectedTrackInput,
  type UnaffectedTrackOutlook,
} from "./unaffected-track.ts";
export {
  computeHaversineMeters,
  computeWalkMinutesFromMeters,
  computeWalkReachMeters,
  estimateWalkMinutes,
  type LonLat,
} from "./walk.ts";
