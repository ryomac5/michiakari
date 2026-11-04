// 決定論的な計算。Claude を呼ばない

export {
  MONTE_CARLO_SAMPLE_COUNT,
  MONTE_CARLO_SEED,
  PREDICTABILITY_HIGH_MAX_RATIO,
  PREDICTABILITY_MEDIUM_MAX_RATIO,
  SHORT_FLOW_MAX_MINUTES,
  STATED_RESUME_SLACK_MINUTES,
} from "../params/estimation.ts";
export * from "../params/routing.ts";
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
  LINE_TYPES,
  type LineType,
  TIMES_OF_DAY,
  type TimeOfDay,
  TRANSIT_PARAMS_SOURCE,
} from "../params/transit.ts";
export { WALK_PARAMS_SOURCE } from "../params/walk.ts";
export { computeArrival, type LegMinutes, sumLegMinutes } from "./arrival.ts";
export {
  type AlternativeArrival,
  type BreakEvenInput,
  type BreakEvenResult,
  checkDeadline,
  computeBreakEven,
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
  compareReplayOutcome,
  OUTCOME_SMALL_DIFF_MINUTES,
  type OutcomeTraveler,
  type ReplayDecision,
  type ReplayOutcome,
  type ReplayOutcomeInput,
  type ReplayOutcomeVerdict,
} from "./outcome.ts";
export { createMulberry32, type Random } from "./random.ts";
export {
  computeQuantile,
  computeResumeFloorRemaining,
  estimateRemaining,
  findPhaseIndex,
  getFirstTrainWait,
  type RemainingOptions,
} from "./remaining.ts";
export {
  type BranchAwareOptions,
  type BranchAwareRemaining,
  enumeratePhasePaths,
  estimateBranchAwareRemaining,
  estimateStatedRemaining,
  estimateStatedRemainingWithoutKnowledge,
  findPhasePaths,
  type PhasePaths,
} from "./remaining-paths.ts";
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
  findOperationPattern,
  inferDefaultOwnTrainType,
  inferTrainsAheadFromPattern,
  normalizeTrainType,
  resolveStationPlatform,
  resolveTrainQueueParams,
  type StationAhead,
  type TrainQueueDelay,
  type TrainQueueInput,
  type TrainQueueOutcome,
} from "./train-queue.ts";
export {
  classifyTimeOfDay,
  computeRideMinutes,
  computeRideMinutesUnrounded,
  computeWaitMinutes,
} from "./transit.ts";
export {
  classifyFlowOutlook,
  describeTypicalFlow,
  estimateUntilResume,
  type FlowOutlook,
  inferPredictabilityLevel,
} from "./typical-flow.ts";
export {
  computeHaversineMeters,
  computeWalkMinutesFromMeters,
  estimateWalkMinutes,
  type LonLat,
} from "./walk.ts";
