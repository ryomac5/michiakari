import type { BreakEvenResult, ComparisonRow, LonLat } from "@repo/core";
import type {
  DurationDist,
  Estimate,
  JudgeRequest,
  Observation,
  RouteOption,
  Scenario,
} from "@repo/schema";
import type { AlternativesProvider } from "../alternatives/provider.ts";
import type { ContentStore } from "../content.ts";
import type { RainReading, RainSummary } from "../domain/weather.ts";

// ツールの実行に必要な文脈と、ツールの結果

export type RainFetcher = (input: {
  coord: LonLat;
  now: string;
  windowMinutes: number;
}) => Promise<{ stationName: string; readings: RainReading[] } | null>;

export type ToolContext = {
  request: JudgeRequest;
  // 今回の入力まで含めた観測の列
  observations: readonly Observation[];
  content: ContentStore;
  provider: AlternativesProvider;
  // リプレイ中のシナリオ。通常時は null
  scenario: Scenario | null;
  fetchRain: RainFetcher;
};

export type EstimateToolResult = {
  estimate: Estimate;
  phaseName: string | null;
  phaseGuidance: string | null;
  phaseStartedAt: string | null;
  statedResumeTime: string | null;
  statedExtended: boolean;
  remainingBasis: "knowledge" | "stated" | "resumed" | null;
  skippedPhaseIds: string[];
  firstTrainWait: DurationDist | null;
  // 現在時刻 + 残り時間。再開して乗れる見込みの時刻
  boardableP50: string | null;
  boardableP80: string | null;
};

export type AlternativesToolResult = {
  options: RouteOption[];
  waitOptionId: string;
  waitRouteMinutesAfterResume: number | null;
  blockedLine: string | null;
  notes: string[];
};

export type BreakEvenToolResult = {
  result: BreakEvenResult | { kind: "no_route" };
  comparison: ComparisonRow[];
  basisOptionIds: string[];
  deadline: string | null;
};

export type WeatherToolResult = {
  source: "scenario" | "jma_amedas" | "unavailable";
  stationName: string | null;
  readings: RainReading[];
  summary: RainSummary;
};

export type ToolState = {
  estimate: EstimateToolResult | null;
  alternatives: AlternativesToolResult | null;
  breakEven: BreakEvenToolResult | null;
  weather: WeatherToolResult | null;
  lookedUpKnowledge: string[];
};

export function createToolState(): ToolState {
  return {
    estimate: null,
    alternatives: null,
    breakEven: null,
    weather: null,
    lookedUpKnowledge: [],
  };
}
