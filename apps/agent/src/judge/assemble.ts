import { diffMinutes, getJstMinuteOfDay } from "@repo/core";
import {
  checkJudgmentRefs,
  type Evidence,
  type Judgment,
  JudgmentSchema,
  type Knowledge,
  type Lang,
  type Observation,
} from "@repo/schema";
import { headlineLimits, reasonLimits } from "../config.ts";
import type { Decision } from "../tools/emit-judgment.ts";
import type {
  AlternativesToolResult,
  BreakEvenToolResult,
  EstimateToolResult,
} from "../tools/types.ts";
import { buildDisclaimer } from "./templates.ts";

// 判断結果の合成と検証。数値はツールの結果から取り、Claude の決定からは数値を受け取らない

export type JudgmentToolResults = {
  estimate: EstimateToolResult;
  alternatives: AlternativesToolResult;
  breakEven: BreakEvenToolResult;
};

export function assembleJudgment(
  results: JudgmentToolResults,
  decision: Decision,
  language: Lang,
): Judgment {
  const r = results.breakEven.result;
  const typicalFlow = results.estimate.typicalFlow;
  return {
    action: decision.action,
    headline: decision.headline,
    reason: decision.reason,
    breakEven:
      r.kind === "future" || r.kind === "passed"
        ? { time: r.time, explanation: decision.breakEvenExplanation }
        : null,
    estimate: results.estimate.estimate,
    options: results.alternatives.options,
    recommendedOptionId: decision.recommendedOptionId,
    evidence: decision.evidence.map((e) => ({
      kind: e.kind,
      id: e.id,
      description: e.description,
    })),
    disclaimer: buildDisclaimer(language),
    ...(typicalFlow ? { typicalFlow } : {}),
  };
}

// 文中の数値。時刻（日本時間の 0 時からの分）、時刻の時だけの表記、分、円に分けて拾う
export type TextNumbers = {
  clocks: { raw: string; minuteOfDay: number }[];
  hours: { raw: string; hour: number }[];
  minutes: { raw: string; value: number }[];
  yen: { raw: string; value: number }[];
};

const CLOCK_PATTERN = /(\d{1,2})時(\d{1,2})分|(\d{1,2}):(\d{2})/g;
const HOURS_DURATION_PATTERN = /(\d+)時間(?:(\d+)分)?/g;
const HOUR_ONLY_PATTERN = /(\d{1,2})時/g;
const MINUTES_PATTERN =
  /(\d+)\s*分|(\d+)\s*(?:(?:more|another|additional|extra)\s+)?(?:minutes|minute|mins|min)\b/gi;
const YEN_PATTERN = /(\d[\d,]*)\s*円|¥\s*(\d[\d,]*)|(\d[\d,]*)\s*yen\b/gi;

const parseNumber = (raw: string) => Number(raw.replaceAll(",", ""));

// 拾った表記は空白に置き換え、後の規則で同じ数字を二重に拾わない
function takeMatches(text: string, pattern: RegExp, take: (m: RegExpMatchArray) => void): string {
  return text.replace(pattern, (...args) => {
    take(args.slice(0, -2) as unknown as RegExpMatchArray);
    return " ";
  });
}

export function extractTextNumbers(text: string): TextNumbers {
  const found: TextNumbers = { clocks: [], hours: [], minutes: [], yen: [] };
  let rest = text.normalize("NFKC");
  rest = takeMatches(rest, CLOCK_PATTERN, (m) => {
    const minuteOfDay = (Number(m[1] ?? m[3]) % 24) * 60 + Number(m[2] ?? m[4]);
    found.clocks.push({ raw: m[0], minuteOfDay });
  });
  rest = takeMatches(rest, HOURS_DURATION_PATTERN, (m) => {
    found.minutes.push({ raw: m[0], value: Number(m[1]) * 60 + Number(m[2] ?? 0) });
  });
  rest = takeMatches(rest, HOUR_ONLY_PATTERN, (m) => {
    found.hours.push({ raw: m[0], hour: Number(m[1]) % 24 });
  });
  rest = takeMatches(rest, YEN_PATTERN, (m) => {
    found.yen.push({ raw: m[0], value: parseNumber(m[1] ?? m[2] ?? m[3] ?? "0") });
  });
  takeMatches(rest, MINUTES_PATTERN, (m) => {
    found.minutes.push({ raw: m[0], value: Number(m[1] ?? m[2]) });
  });
  return found;
}

// 文に書いてよい数値。ツールの結果、観測の原文、サーバーが作った根拠の説明から集める
export type AllowedNumbers = {
  clockMinutes: Set<number>;
  hours: Set<number>;
  minutes: Set<number>;
  yen: Set<number>;
};

export type AllowedNumbersInput = {
  results: JudgmentToolResults;
  observations: readonly Observation[];
  now: string;
  knowledge: Knowledge | null;
  evidenceRefs: readonly Evidence[];
};

export function collectAllowedNumbers(input: AllowedNumbersInput): AllowedNumbers {
  const { results, observations, now, knowledge } = input;
  const r = results.breakEven.result;
  const hasBreakEven = r.kind === "future" || r.kind === "passed";
  const isoTimes: (string | null)[] = [
    now,
    results.estimate.statedResumeTime,
    results.estimate.boardableP50,
    results.estimate.boardableP80,
    results.estimate.phaseStartedAt,
    results.breakEven.deadline,
    ...results.alternatives.options.map((o) => o.arrivalTime),
    ...results.breakEven.comparison.map((c) => c.arrivalTime),
    ...observations.flatMap((o) => [o.observedAt, o.statedResumeTime]),
    ...(hasBreakEven
      ? [
          r.time,
          r.bestAlternativeArrival,
          r.resumeOutlook?.resumeP50 ?? null,
          r.resumeOutlook?.resumeP80 ?? null,
        ]
      : []),
  ];
  const estimate = results.estimate;
  const minuteValues: (number | null | undefined)[] = [
    estimate.estimate.remaining?.p50,
    estimate.estimate.remaining?.p80,
    estimate.estimate.elapsedMinutes,
    estimate.firstTrainWait?.p50,
    estimate.firstTrainWait?.p80,
    results.alternatives.waitRouteMinutesAfterResume,
    // よくある流れの再開までの見込みと目安の下限。結論の文で事象の流れを伝えるのに使う
    estimate.typicalFlow?.untilResume.p50,
    estimate.typicalFlow?.untilResume.p80,
    estimate.typicalFlow?.typicalFloorMinutes,
    ...results.alternatives.options.flatMap((o) => [
      o.walkMinutes,
      Math.round(diffMinutes(now, o.arrivalTime)),
      ...o.legs.map((l) => l.minutes),
    ]),
    ...results.breakEven.comparison.flatMap((c) => [c.minutesFromNow, c.deadline?.marginMinutes]),
    ...(hasBreakEven
      ? [r.minutesFromNow, r.resumeOutlook?.marginP50Minutes, r.resumeOutlook?.marginP80Minutes]
      : []),
    ...(knowledge
      ? [
          ...knowledge.phases.flatMap((p) => [p.duration_minutes.p50, p.duration_minutes.p80]),
          knowledge.after_resume.first_train_wait_minutes.p50,
          knowledge.after_resume.first_train_wait_minutes.p80,
        ]
      : []),
  ];
  const allowed: AllowedNumbers = {
    clockMinutes: new Set(isoTimes.flatMap((t) => (t ? [getJstMinuteOfDay(t)] : []))),
    hours: new Set(),
    minutes: new Set(minuteValues.flatMap((v) => (typeof v === "number" ? [Math.abs(v)] : []))),
    yen: new Set(
      results.alternatives.options.flatMap((o) => (o.fareYen === null ? [] : [o.fareYen])),
    ),
  };
  const sources = [
    ...observations.map((o) => o.rawText ?? ""),
    ...input.evidenceRefs.map((e) => e.description),
  ];
  for (const text of sources) {
    const numbers = extractTextNumbers(text);
    for (const c of numbers.clocks) allowed.clockMinutes.add(c.minuteOfDay);
    for (const h of numbers.hours) allowed.hours.add(h.hour);
    for (const m of numbers.minutes) allowed.minutes.add(m.value);
    for (const y of numbers.yen) allowed.yen.add(y.value);
  }
  for (const minute of allowed.clockMinutes) allowed.hours.add(Math.floor(minute / 60));
  return allowed;
}

// 文中の数値のうち、許された集合に無いものを指摘する
function findUnknownNumbers(field: string, text: string, allowed: AllowedNumbers): string[] {
  const n = extractTextNumbers(text);
  const unknown = [
    ...n.clocks.filter((c) => !allowed.clockMinutes.has(c.minuteOfDay)).map((c) => c.raw),
    ...n.hours.filter((h) => !allowed.hours.has(h.hour)).map((h) => h.raw),
    ...n.minutes.filter((m) => !allowed.minutes.has(m.value)).map((m) => m.raw),
    ...n.yen.filter((y) => !allowed.yen.has(y.value)).map((y) => y.raw),
  ];
  return unknown.map(
    (raw) =>
      `${field} の数値「${raw.trim()}」がツールの結果にありません。ツールの結果の値を使ってください`,
  );
}

// 見出しが上限より長ければ指摘する。理由は reason へ回すよう促す
export function checkHeadlineLength(headline: string, language: Lang): string[] {
  const length = [...headline].length;
  const { target, max } = headlineLimits[language];
  if (length <= max) return [];
  return [
    `headline が長すぎます。${length} 文字で、上限は ${max} 文字です。結論だけを ${target} 文字程度で書き、理由は reason に回してください`,
  ];
}

// 理由が上限より長ければ指摘する
export function checkReasonLength(reason: string | undefined, language: Lang): string[] {
  const length = [...(reason ?? "")].length;
  const { target, max } = reasonLimits[language];
  if (length <= max) return [];
  return [
    `reason が長すぎます。${length} 文字で、上限は ${max} 文字です。判断の根拠を比較の形で ${target} 文字程度の 1〜2 文にまとめてください`,
  ];
}

// 判断しない旨の言い回し。情報が足りなくても、結論はいまの最善の一手を言い切る
const NON_DECISION_PATTERNS: Record<Lang, RegExp> = {
  ja: /判断できません|判断できない|判断を保留|判断は保留|まだ判断|分かりません|わかりません|どちらとも言え|情報が足りません|材料が不足|見込みが立ちません|読めません/,
  en: /too early to (decide|tell|judge)|can't|cannot|unable to|unknown|not enough information|holding off/i,
};

// 見出しと理由に、判断しない旨の言い回しがあれば指摘する
export function checkDecisiveWording(field: string, text: string, language: Lang): string[] {
  const match = NON_DECISION_PATTERNS[language].exec(text);
  if (!match) return [];
  return [
    `${field} の「${match[0]}」は判断しない旨の言い回しです。待つ、切り替える、分岐点の時刻まで待ち動かなければ切り替える、のどれかの行動で書いてください`,
  ];
}

export type JudgmentCheckInput = {
  judgment: unknown;
  language: Lang;
  evidenceRefs: readonly Evidence[];
  allowedNumbers: AllowedNumbers;
};

// スキーマ、ID 参照、根拠の出どころ、文中の数値を検査し、問題を文字列で返す
export function validateJudgment(input: JudgmentCheckInput): {
  judgment: Judgment | null;
  errors: string[];
} {
  const parsed = JudgmentSchema.safeParse(input.judgment);
  if (!parsed.success) {
    return {
      judgment: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(ルート)"}: ${i.message}`),
    };
  }
  const j = parsed.data;
  const errors = [
    ...checkJudgmentRefs(j),
    ...checkHeadlineLength(j.headline, input.language),
    ...checkReasonLength(j.reason, input.language),
    ...checkDecisiveWording("headline", j.headline, input.language),
    ...checkDecisiveWording("reason", j.reason ?? "", input.language),
  ];

  for (const e of j.evidence) {
    if (!input.evidenceRefs.some((r) => r.kind === e.kind && r.id === e.id)) {
      errors.push(`根拠がツールの結果にありません: ${e.kind}/${e.id}`);
    }
  }
  const recommended = j.options.find((o) => o.id === j.recommendedOptionId);
  if (j.action === "switch" && recommended?.kind === "wait") {
    errors.push("action が switch のときは待つ以外の選択肢を推奨してください");
  }
  if (j.action === "wait" && recommended && recommended.kind !== "wait") {
    errors.push("action が wait のときは recommendedOptionId を待つ選択肢か null にしてください");
  }
  const texts: [string, string][] = [
    ["headline", j.headline],
    ["reason", j.reason ?? ""],
    ["breakEven.explanation", j.breakEven?.explanation ?? ""],
    ...j.evidence.map((e, i): [string, string] => [`evidence[${i}].description`, e.description]),
  ];
  for (const [field, text] of texts)
    errors.push(...findUnknownNumbers(field, text, input.allowedNumbers));
  return { judgment: errors.length === 0 ? j : null, errors };
}
