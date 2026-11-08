import type {
  BreakEvenResult,
  ComparisonRow,
  ConcreteTrainType,
  IncidentEstimateBasis,
  IncidentFlowOutlook,
  LonLat,
  TrainQueueOutcome,
} from "@repo/core";
import type {
  AnnouncementCueId,
  DurationDist,
  Estimate,
  InCarChance,
  JudgeRequest,
  Observation,
  ResumeChance,
  ResumeQueue,
  RouteOption,
  Scenario,
  StopReasons,
  UnaffectedTrack,
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

// 駅間の車内にいる利用者が、ホームに着ける駅に着く見込み。駅間でなければ null
export type TrainQueueToolResult = TrainQueueOutcome & {
  nextStation: string;
  ownTrainType: ConcreteTrainType;
  // 前の列車の種別の並びが分かっているか。分からなければ本数の目安で置いている
  sequenceKnown: boolean;
  // 詰める動きを追った路線。路線上で結べなければ null
  lineId: string | null;
  // 時刻ごとの、自分の列車が動き出している見込み。packages/core の値。動き出す見込みが無ければ null
  departureChance: InCarChance | null;
};

export type EstimateToolResult = {
  estimate: Estimate;
  trainQueue: TrainQueueToolResult | null;
  statedResumeTime: string | null;
  statedExtended: boolean;
  // 残り時間の根拠。core の estimateIncidentRemaining の basis。見込みが無ければ null
  remainingBasis: IncidentEstimateBasis | null;
  // 再開から乗れる列車が来るまで。規則表の止まり方から引く
  firstTrainWait: DurationDist | null;
  // 現在時刻 + 残り時間。再開して乗れる見込みの時刻
  boardableP50: string | null;
  boardableP80: string | null;
  // 種類の長さの見込み。種類が分からなければ unknown
  flowOutlook: IncidentFlowOutlook;
  // めったに無い事象で、見込みの数字を言い切らない
  withholdNumbers: boolean;
  // 天気の事象か。気象を確かめるかを決める
  weatherIncident: boolean;
  // 観測から拾った放送の手がかり
  cues: AnnouncementCueId[];
  // 防護無線の事象か。周りの同じ会社の列車も一斉に止まる
  protection: boolean;
  // 支障の無い線路が先に動く見込み。防護無線の事象でなければ null
  unaffectedTrack: UnaffectedTrack | null;
  // 再開後の詰まりの見込み。列車の中にいないか、詰まりの放送が無ければ null
  resumeQueue: ResumeQueue | null;
  // 自分の列車が止まった理由ごとの割合。列車の中にいないか、種類も手がかりも無ければ null
  stopReasons: StopReasons | null;
  // 確率の計算に使う、乗れるまでの残り時間の標本（分、昇順）。remaining が null なら null。Claude には渡さない
  remainingSamples?: readonly number[] | null;
  // 発生とみなした時刻。最初の観測の時刻
  onsetTime?: string | null;
};

export type AlternativesToolResult = {
  // 先頭は待つ選択肢。防護無線の事象では、残りを上げる・そのまま・下げるの順に並べる
  options: RouteOption[];
  // 防護無線の事象で下げた選択肢。止まった会社と同じ会社の線で、最初は一緒に止まる
  loweredOptionIds?: string[];
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
};

export function createToolState(): ToolState {
  return {
    estimate: null,
    alternatives: null,
    breakEven: null,
    weather: null,
  };
}
