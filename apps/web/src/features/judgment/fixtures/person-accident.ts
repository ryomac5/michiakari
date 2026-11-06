import type {
  DetectedSignal,
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  RouteOption,
} from "@repo/schema";
import { entryLineObservationId } from "@/features/entry/seed";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { formatClockInSentence, formatIsoWithOffset } from "../time";

// 開発用の架空シナリオ「人身事故・終電間際」。実在の事故記録や発表文ではない
// 時刻はすべて要求の now からの相対で作る。数値は画面確認用の仮の値で、計算の結果ではない

const eventType = "person_accident";

// モックで使う知見の抜粋。モックの間は knowledge/ に同じ id があってもこちらを優先する
export const personAccidentCatalog: KnowledgeCatalog = [
  {
    id: eventType,
    name: { ja: "人身事故", en: "Person struck by train" },
    phases: [
      {
        id: "occurrence",
        name: { ja: "発生直後", en: "Just occurred" },
        signals: [
          {
            id: "accident_announced",
            description: "人身事故の発生と運転見合わせが案内される",
            example_phrases: ["人身事故のため、運転を見合わせています"],
          },
        ],
      },
      {
        id: "rescue",
        name: { ja: "救護・確認", en: "Rescue and checks" },
        signals: [
          {
            id: "rescue_announced",
            description: "救護活動を行っている旨が案内される",
            example_phrases: ["ただいま救護活動を行っています"],
          },
        ],
      },
      {
        id: "on_site",
        name: { ja: "現場対応", en: "On-site response" },
        signals: [
          {
            id: "site_check_announced",
            description: "現場の確認が続いている旨が案内される",
            example_phrases: ["現在、現場の確認を行っています"],
          },
          {
            id: "transfer_started",
            description: "振替輸送の実施が案内される",
            example_phrases: ["他の鉄道会社線で振替輸送を行っています"],
          },
        ],
      },
      {
        id: "resume_prep",
        name: { ja: "再開準備", en: "Preparing to resume" },
        signals: [
          {
            id: "resume_time_announced",
            description: "運転再開の見込み時刻が案内される",
            example_phrases: ["運転再開は○時○分頃の見込みです"],
          },
          {
            id: "trains_moving",
            description: "止まっていた列車が動き始める",
            example_phrases: ["停車中の列車がゆっくり動き出した"],
          },
        ],
      },
    ],
  },
];

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function readInputText(request: JudgeRequest, fallback: string): string {
  const input = request.newInput;
  if (input?.type === "text") return input.text;
  if (input?.type === "scenario") return input.text.ja;
  return fallback;
}

function buildObservation(
  request: JudgeRequest,
  id: string,
  now: Date,
  fallbackText: string,
  signals: DetectedSignal[],
): Observation {
  const source = request.newInput?.type ?? "text";
  return {
    id,
    observedAt: formatIsoWithOffset(now),
    source,
    kind: source === "photo" ? "signage" : "announcement",
    rawText: readInputText(request, fallbackText),
    eventTypeCandidates: [{ eventType, confidence: "high" }],
    operator: "JR西日本",
    line: "JR神戸線",
    section: { fromStation: "大阪", toStation: "三ノ宮" },
    statedResumeTime: null,
    transferServiceActive: true,
    detectedSignals: signals,
  };
}

function buildOptions(now: Date, isFollowUp: boolean, en: boolean): RouteOption[] {
  const shift = isFollowUp ? 12 : 0;
  return [
    {
      id: "wait_resume",
      kind: "wait",
      label: en ? "Wait for JR Kobe Line to resume" : "JR神戸線の再開を待つ",
      legs: [
        { mode: "wait", from: "大阪", to: "大阪", minutes: 10 + shift },
        { mode: "ride", from: "大阪", to: "三ノ宮", minutes: 22, line: "JR神戸線" },
      ],
      arrivalTime: formatIsoWithOffset(addMinutes(now, 38 + shift)),
      fareYen: null,
      walkMinutes: 0,
      isTransferService: false,
    },
    {
      id: "transfer_hankyu",
      kind: "transfer",
      label: en ? "Transfer service via Hankyu Kobe Line" : "阪急神戸線で振替輸送",
      legs: [
        { mode: "walk", from: "大阪", to: "大阪梅田", minutes: 8 },
        { mode: "wait", from: "大阪梅田", to: "大阪梅田", minutes: 4 },
        { mode: "ride", from: "大阪梅田", to: "神戸三宮", minutes: 27, line: "阪急神戸線" },
        { mode: "walk", from: "神戸三宮", to: "三ノ宮", minutes: 3 },
      ],
      arrivalTime: formatIsoWithOffset(addMinutes(now, 42 - (isFollowUp ? 2 : 0))),
      fareYen: null,
      walkMinutes: 11,
      isTransferService: true,
    },
    {
      id: "taxi",
      kind: "taxi",
      label: en ? "Taxi" : "タクシー",
      legs: [
        { mode: "walk", from: "大阪", to: "大阪駅タクシー乗り場", minutes: 3 },
        { mode: "taxi", from: "大阪駅タクシー乗り場", to: "三ノ宮", minutes: 45 },
      ],
      arrivalTime: formatIsoWithOffset(addMinutes(now, 48)),
      fareYen: 11800,
      walkMinutes: 3,
      isTransferService: false,
    },
  ];
}

function buildFirstJudgment(request: JudgeRequest, now: Date): Judgment {
  const en = request.language === "en";
  const breakEvenTime = addMinutes(now, 14);
  const clock = formatClockInSentence(breakEvenTime.toISOString(), request.language);
  return {
    action: "wait",
    headline: en
      ? `Wait until ${clock}. If still stopped, take the Hankyu Kobe Line.`
      : `${clock}まで待つ。動かなければ阪急神戸線へ`,
    reason: en ? "Waiting should get you there sooner." : "待つほうが早く着く見込みです。",
    breakEven: {
      time: formatIsoWithOffset(breakEvenTime),
      explanation: en
        ? `If service restarts by ${clock}, waiting gets you there sooner.`
        : `${clock}までに再開すれば待つほうが早く着きます。`,
    },
    estimate: {
      eventType,
      phaseId: "on_site",
      elapsedMinutes: 12,
      remaining: { p50: 10, p80: 25 },
      confidence: "medium",
    },
    options: buildOptions(now, false, en),
    recommendedOptionId: "wait_resume",
    evidence: [
      {
        kind: "signal",
        id: "site_check_announced",
        description: en
          ? "The announcement says on-site checks continue."
          : "現場の確認が続いていると発表がありました。",
      },
      {
        kind: "knowledge",
        id: `${eventType}.on_site`,
        description: en ? "Service is at the on-site check stage." : "いまは現場の確認の段階です。",
      },
      {
        kind: "computation",
        id: "compute_break_even",
        description: en
          ? "We compared arrival times for waiting and the Hankyu Kobe Line."
          : "待つ場合と阪急神戸線の振替の到着時刻を比べました。",
      },
    ],
    disclaimer: en
      ? "Estimate only. Follow official notices."
      : "推定であり、公式発表を優先してください。",
  };
}

function buildFollowUpJudgment(request: JudgeRequest, now: Date): Judgment {
  const en = request.language === "en";
  const breakEvenTime = addMinutes(now, -3);
  const clock = formatClockInSentence(breakEvenTime.toISOString(), request.language);
  return {
    action: "switch",
    headline: en
      ? "Walk to Osaka-umeda for the Hankyu Kobe Line."
      : "大阪梅田まで歩いて阪急神戸線へ",
    reason: en
      ? "Even a restart now is slower than the Hankyu Kobe Line."
      : "いま動いても阪急神戸線のほうが早く着きます。",
    breakEven: {
      time: formatIsoWithOffset(breakEvenTime),
      explanation: en
        ? `Service did not restart by ${clock}. The Hankyu Kobe Line is now faster.`
        : `${clock}までに再開しませんでした。阪急神戸線の振替のほうが早く着きます。`,
    },
    estimate: {
      eventType,
      phaseId: "on_site",
      elapsedMinutes: 27,
      remaining: { p50: 20, p80: 40 },
      confidence: "medium",
    },
    options: buildOptions(now, true, en),
    recommendedOptionId: "transfer_hankyu",
    evidence: [
      {
        kind: "signal",
        id: "transfer_started",
        description: en
          ? "The announcement says transfer service has started."
          : "振替輸送を行っていると発表がありました。",
      },
      {
        kind: "knowledge",
        id: `${eventType}.on_site`,
        description: en ? "On-site checks are still going on." : "現場の確認が長引いています。",
      },
      {
        kind: "computation",
        id: "compute_break_even",
        description: en ? "The cutoff time has passed." : "境目の時刻を過ぎました。",
      },
    ],
    disclaimer: en
      ? "Estimate only. Follow official notices."
      : "推定であり、公式発表を優先してください。",
  };
}

// 1 回目は「待つ」、情報を追加した 2 回目以降は「切り替える」を返す
export function buildPersonAccidentEvents(request: JudgeRequest): JudgmentEvent[] {
  const now = new Date(request.now);
  // 入口で選んだ路線の観測は数えない。掲示や発表を読み取った観測があるときだけ続きの判断にする
  const isFollowUp = request.observations.some((o) => o.id !== entryLineObservationId);
  const judgment = isFollowUp
    ? buildFollowUpJudgment(request, now)
    : buildFirstJudgment(request, now);

  const signals: DetectedSignal[] = isFollowUp
    ? [{ eventType, signalId: "transfer_started", quote: "振替輸送を行っています" }]
    : [
        { eventType, signalId: "accident_announced", quote: "人身事故のため" },
        { eventType, signalId: "site_check_announced", quote: "現場の確認を行っています" },
      ];

  const observation = buildObservation(
    request,
    `mock_obs_${request.observations.length + 1}`,
    now,
    "人身事故のため、運転を見合わせています。現在、現場の確認を行っています。",
    signals,
  );

  const bodies = [
    ...(request.newInput === null ? [] : [{ type: "observation_parsed" as const, observation }]),
    ...signals.map((signal) => ({ type: "signal_detected" as const, signal })),
    { type: "phase_estimated" as const, estimate: judgment.estimate },
    { type: "alternatives_computed" as const, options: judgment.options },
    { type: "break_even_computed" as const, breakEven: judgment.breakEven },
    { type: "judgment_ready" as const, judgment },
  ];

  return bodies.map((body, seq) => ({
    ...body,
    seq,
    at: formatIsoWithOffset(new Date(now.getTime() + seq * 1000)),
  }));
}
