// 決定論的な計算。Claude を呼ばない

export {
  MONTE_CARLO_SAMPLE_COUNT,
  MONTE_CARLO_SEED,
  PREDICTABILITY_HIGH_MAX_RATIO,
  PREDICTABILITY_MEDIUM_MAX_RATIO,
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
  classifyTimeOfDay,
  computeRideMinutes,
  computeRideMinutesUnrounded,
  computeWaitMinutes,
} from "./transit.ts";
export {
  describeTypicalFlow,
  estimateUntilResume,
  inferPredictabilityLevel,
} from "./typical-flow.ts";
export {
  computeHaversineMeters,
  computeWalkMinutesFromMeters,
  estimateWalkMinutes,
  type LonLat,
} from "./walk.ts";
