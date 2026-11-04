import type {
  BreakEvenResult,
  ComparisonRow,
  ConcreteTrainType,
  LonLat,
  TrainQueueOutcome,
} from "@repo/core";
import type {
  DurationDist,
  Estimate,
  JudgeRequest,
  Observation,
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

// 駅間の車内にいる利用者が、ホームに着ける駅に着く見込み。駅間でなければ null
export type TrainQueueToolResult = TrainQueueOutcome & {
  nextStation: string;
  ownTrainType: ConcreteTrainType;
  // 前の列車の種別の並びが分かっているか。分からなければ本数の目安で置いている
  sequenceKnown: boolean;
  // 詰める動きを追った路線。路線上で結べなければ null
  lineId: string | null;
};

export type EstimateToolResult = {
  estimate: Estimate;
  trainQueue: TrainQueueToolResult | null;
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
