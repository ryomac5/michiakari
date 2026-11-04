import type { BreakEvenResult, ComparisonRow, LonLat } from "@repo/core";
import type {
  DurationDist,
  Estimate,
  JudgeRequest,
  Observation,
  ResumeChance,
  RouteOption,
  Scenario,
  TypicalFlow,
} from "@repo/schema";
import type { AlternativesProvider } from "../alternatives/provider.ts";
import type { ContentStore } from "../content.ts";
import type { FlowOutlook } from "../domain/typical-flow.ts";
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
  // 事象のよくある流れ。事象が分からなければ null
  typicalFlow: TypicalFlow | null;
  // 見込みが立てやすい事象なら、短く終わるか長くかかるか。結論の言葉に使う
  flowOutlook: FlowOutlook | null;
  // 結論の理由の頭に置く一文。flowOutlook が null なら null
  flowSentence: string | null;
  // 確率の計算に使う、乗れるまでの残り時間の標本（分、昇順）。remaining が null なら null。Claude には渡さない
  remainingSamples?: readonly number[] | null;
  // 発生とみなした時刻。最初の観測の時刻
  onsetTime?: string | null;
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
  // 時刻ごとの再開の見込みと、待ったほうが早く着く確率。残り時間の見込みが無ければ null
  resumeChance?: ResumeChance | null;
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
