import { getJstMinuteOfDay } from "@repo/core";
import {
  checkJudgmentRefs,
  type Evidence,
  type Judgment,
  JudgmentSchema,
  type Lang,
  type Observation,
} from "@repo/schema";
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
  return {
    action: decision.action,
    headline: decision.headline,
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
  };
}

const CLOCK_IN_TEXT = /(\d{1,2})時(\d{1,2})分|(\d{1,2}):(\d{2})/g;

function collectClockMinutes(text: string): number[] {
  return [...text.normalize("NFKC").matchAll(CLOCK_IN_TEXT)].map(
    (m) => (Number(m[1] ?? m[3]) % 24) * 60 + Number(m[2] ?? m[4]),
  );
}

// 文に書いてよい時刻（ツールの結果と観測に現れる時刻）を日本時間の分で集める
export function collectAllowedClockMinutes(
  results: JudgmentToolResults,
  observations: readonly Observation[],
  now: string,
): Set<number> {
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
  ];
  const r = results.breakEven.result;
  if (r.kind === "future" || r.kind === "passed") {
    isoTimes.push(
      r.time,
      r.bestAlternativeArrival,
      r.resumeOutlook?.resumeP50 ?? null,
      r.resumeOutlook?.resumeP80 ?? null,
    );
  }
  const minutes = new Set(isoTimes.flatMap((t) => (t ? [getJstMinuteOfDay(t)] : [])));
  for (const o of observations) {
    for (const m of collectClockMinutes(o.rawText ?? "")) minutes.add(m);
  }
  return minutes;
}

export type JudgmentCheckInput = {
  judgment: unknown;
  evidenceRefs: readonly Evidence[];
  allowedClockMinutes: ReadonlySet<number>;
};

// スキーマ、ID 参照、根拠の出どころ、文中の時刻を検査し、問題を文字列で返す
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
  const errors = checkJudgmentRefs(j);

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
  for (const [field, text] of [
    ["headline", j.headline],
    ["breakEven.explanation", j.breakEven?.explanation ?? ""],
  ] as const) {
    for (const minute of collectClockMinutes(text)) {
      if (!input.allowedClockMinutes.has(minute)) {
        const hh = Math.floor(minute / 60);
        const mm = String(minute % 60).padStart(2, "0");
        errors.push(
          `${field} の時刻 ${hh}:${mm} がツールの結果にありません。ツールの結果の時刻を使ってください`,
        );
      }
    }
  }
  return { judgment: errors.length === 0 ? j : null, errors };
}
