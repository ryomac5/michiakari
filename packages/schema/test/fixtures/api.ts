import type { JudgeRequest, Judgment, Observation } from "../../src/index.ts";

// API・SSE の合格例。テストでは structuredClone して書き換える

export const validObservation: Observation = {
  id: "obs_1",
  observedAt: "2026-11-05T22:40:00+09:00",
  source: "scenario",
  kind: "announcement",
  rawText: "架空の発表文",
  eventTypeCandidates: [{ eventType: "sample_event", confidence: "high" }],
  operator: "架空鉄道",
  line: "架空線",
  section: { fromStation: "甲駅", toStation: "乙駅" },
  statedResumeTime: null,
  transferServiceActive: true,
  detectedSignals: [
    { eventType: "sample_event", signalId: "checking_announced", quote: "確認を行っています" },
  ],
};

export const validJudgeRequest: JudgeRequest = {
  observations: [validObservation],
  newInput: { type: "text", text: "架空の発表文その2" },
  origin: { kind: "station", name: "甲駅" },
  destination: { kind: "coord", lon: 135.5, lat: 34.7 },
  constraints: {
    deadline: "2026-11-05T23:45:00+09:00",
    knowsAlternatives: false,
    mobilityNotes: null,
  },
  language: "ja",
  now: "2026-11-05T22:55:00+09:00",
};

export const validJudgment: Judgment = {
  action: "switch",
  headline: "振替輸送で丙駅へ向かう見込みが立ちます",
  breakEven: {
    time: "2026-11-05T23:10:00+09:00",
    explanation: "この時刻を過ぎて再開しない場合は切り替えたほうが早く着きます",
  },
  estimate: {
    eventType: "sample_event",
    phaseId: "working",
    elapsedMinutes: 15,
    remaining: { p50: 20, p80: 40 },
    confidence: "medium",
  },
  options: [
    {
      id: "transfer_1",
      kind: "transfer",
      label: "他線で振替",
      legs: [
        { mode: "walk", from: "甲駅", to: "丁駅", minutes: 8 },
        { mode: "ride", from: "丁駅", to: "丙駅", minutes: 20, line: "架空第二線" },
      ],
      arrivalTime: "2026-11-05T23:30:00+09:00",
      fareYen: null,
      walkMinutes: 8,
      isTransferService: true,
    },
  ],
  recommendedOptionId: "transfer_1",
  evidence: [{ kind: "signal", id: "work_started", description: "対応開始の放送" }],
  disclaimer: "推定です。公式発表を優先してください。",
};
