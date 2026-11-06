import type { StopScope } from "@repo/core";
import { diffMinutes, getJstMinuteOfDay } from "@repo/core";
import {
  checkJudgmentRefs,
  type Evidence,
  type InCarGuide,
  type Judgment,
  JudgmentSchema,
  type Knowledge,
  type Lang,
  type Observation,
  type Section,
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

// 駅間の車内の人には、境目と選択肢の一覧を付けず、車内の案内だけを付ける
export function assembleJudgment(
  results: JudgmentToolResults,
  decision: Decision,
  language: Lang,
  inCar: InCarGuide | null = null,
): Judgment {
  if (inCar) {
    const typicalFlow = results.estimate.typicalFlow;
    return {
      action: decision.action,
      headline: decision.headline,
      reason: decision.reason,
      breakEven: null,
      estimate: results.estimate.estimate,
      options: [],
      recommendedOptionId: decision.recommendedOptionId,
      evidence: decision.evidence.map((e) => ({
        kind: e.kind,
        id: e.id,
        description: e.description,
      })),
      disclaimer: buildDisclaimer(language),
      ...(typicalFlow ? { typicalFlow } : {}),
      inCar,
    };
  }
  const r = results.breakEven.result;
  const typicalFlow = results.estimate.typicalFlow;
  // 時刻ごとの再開の見込みと、待ったほうが早く着く確率。分岐点の計算で求め、分岐点と一緒に届ける
  const resumeChance = results.breakEven.resumeChance ?? null;
  return {
    action: decision.action,
    headline: decision.headline,
    reason: decision.reason,
    breakEven:
      r.kind === "future" || r.kind === "passed"
        ? {
            time: r.time,
            explanation: decision.breakEvenExplanation,
            ...(resumeChance ? { resumeChance } : {}),
          }
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

// 文中の数値。時刻（日本時間の 0 時からの分）、時刻の時だけの表記、分、円、割合に分けて拾う
export type TextNumbers = {
  clocks: { raw: string; minuteOfDay: number }[];
  hours: { raw: string; hour: number }[];
  minutes: { raw: string; value: number }[];
  yen: { raw: string; value: number }[];
  // 「3割」「30%」。1 割単位に直した値。「1割未満」は 1、「9割以上」は 9 として拾う
  shares: { raw: string; tenths: number }[];
};

const CLOCK_PATTERN = /(\d{1,2})時(\d{1,2})分|(\d{1,2}):(\d{2})/g;
const HOURS_DURATION_PATTERN = /(\d+)時間(?:(\d+)分)?/g;
const HOUR_ONLY_PATTERN = /(\d{1,2})時/g;
const MINUTES_PATTERN =
  /(\d+)\s*分|(\d+)\s*(?:(?:more|another|additional|extra)\s+)?(?:minutes|minute|mins|min)\b/gi;
const YEN_PATTERN = /(\d[\d,]*)\s*円|¥\s*(\d[\d,]*)|(\d[\d,]*)\s*yen\b/gi;
const SHARE_PATTERN = /(\d{1,2})\s*割|(\d{1,3})\s*(?:%|％|percent|per cent)/gi;

const parseNumber = (raw: string) => Number(raw.replaceAll(",", ""));

// 拾った表記は空白に置き換え、後の規則で同じ数字を二重に拾わない
function takeMatches(text: string, pattern: RegExp, take: (m: RegExpMatchArray) => void): string {
  return text.replace(pattern, (...args) => {
    take(args.slice(0, -2) as unknown as RegExpMatchArray);
    return " ";
  });
}

export function extractTextNumbers(text: string): TextNumbers {
  const found: TextNumbers = { clocks: [], hours: [], minutes: [], yen: [], shares: [] };
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
  rest = takeMatches(rest, SHARE_PATTERN, (m) => {
    const tenths = m[1] !== undefined ? Number(m[1]) : Number(m[2]) / 10;
    found.shares.push({ raw: m[0], tenths });
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
  // 1 割単位の確率。ツールの resumeChance の値。1 割未満は 1、9 割以上は 9 として許す
  shares: Set<number>;
};

// 「1割未満」は「1割」、「9割以上」は「9割」と書かれるので、その数字で許す
function toWrittenTenths(tenths: number): number {
  return tenths <= 0 ? 1 : tenths >= 10 ? 9 : tenths;
}

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
  const chance = results.breakEven.resumeChance ?? null;
  const isoTimes: (string | null)[] = [
    now,
    results.estimate.statedResumeTime,
    results.estimate.boardableP50,
    results.estimate.boardableP80,
    results.estimate.phaseStartedAt,
    // 駅間の車内なら、ホームに着ける駅に着く見込みの時刻と、自分の列車が動き出す見込みの時刻
    results.estimate.trainQueue?.arrival?.p50 ?? null,
    results.estimate.trainQueue?.arrival?.p80 ?? null,
    results.estimate.trainQueue?.departure?.p50 ?? null,
    results.estimate.trainQueue?.departure?.p80 ?? null,
    results.breakEven.deadline,
    // 確率の目盛りの時刻、期限に間に合うために動いていなければならない時刻、発生とみなした時刻
    ...(chance
      ? [chance.resumeByForDeadline, chance.onsetTime, ...chance.ticks.map((t) => t.time)]
      : []),
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
    // 目盛りの発生からの分と、いまからの分。「1時間後」の言い方に使う
    ...(chance
      ? [
          chance.stepMinutes,
          ...chance.ticks.flatMap((t) => [
            t.sinceOnsetMinutes,
            Math.round(diffMinutes(now, t.time)),
          ]),
        ]
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
    shares: new Set(
      (chance ? [chance.waitFaster, chance.waitOnTime, ...chance.ticks.map((t) => t.tenths)] : [])
        .filter((v): v is number => v !== null)
        .map(toWrittenTenths),
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
    for (const share of numbers.shares) allowed.shares.add(share.tenths);
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
    ...n.shares.filter((s) => !allowed.shares.has(s.tenths)).map((s) => s.raw),
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

// 切り替えを勧める言い回し。駅間の車内の人には使わない
const SWITCH_PATTERNS: Record<Lang, RegExp> = {
  ja: /乗り換え|乗換|切り替え|切替|タクシー|振替|降りて|歩いて/,
  en: /\b(change to|change trains|switch|taxi|get off|transfer|walk)/i,
};

// 区間全体の運転見合わせを指す言い回し。その列車だけが止まる事象には使わない
const SUSPENSION_PATTERNS: Record<Lang, RegExp> = {
  ja: /見合わせ/,
  en: /suspen/i,
};

// 駅間の車内の人に切り替えを勧めていれば指摘する。代替手段の路線名も勧める言葉とみなす
export function checkInCarWording(
  field: string,
  text: string,
  language: Lang,
  alternativeLines: readonly string[],
): string[] {
  const match =
    SWITCH_PATTERNS[language].exec(text)?.[0] ?? alternativeLines.find((l) => text.includes(l));
  if (!match) return [];
  return [
    `${field} の「${match}」は切り替えを勧める言葉です。駅間の車内の人は降りられないので、車内で待つことだけを書いてください`,
  ];
}

// その列車だけが止まる事象で、運転見合わせと書いていれば指摘する
export function checkStopScopeWording(field: string, text: string, language: Lang): string[] {
  const match = SUSPENSION_PATTERNS[language].exec(text);
  if (!match) return [];
  return [
    `${field} の「${match[0]}」は区間全体が止まる言い方です。この事象で止まっているのはその列車だけです。停車中や後続の遅れとして書いてください`,
  ];
}

// 区間の検査に使う文脈。発表の区間と、駅の間の車内なら利用者のいる 2 駅
export type SectionWordingContext = {
  announcedSection: Section | null;
  trainPosition: { previousStation: string | null; nextStation: string | null } | null;
};

type StationRange = { from: string; to: string; text: string; position: boolean; sentence: string };

// 駅名の並び。ひらがなは助詞と見分けられないので含めない
const JA_NAME = "[一-龥々〆ヶァ-ヴーA-Za-z0-9]+";
const JA_RANGE_PATTERNS: readonly { pattern: RegExp; needsContext: boolean }[] = [
  // 大阪〜京都、大阪 - 京都、大阪駅〜京都駅間
  {
    pattern: new RegExp(`(${JA_NAME})駅?\\s*[〜～~\\-－–—]\\s*(${JA_NAME})`, "g"),
    needsContext: false,
  },
  // 大阪・京都間、大阪と京都の間
  {
    pattern: new RegExp(`(${JA_NAME})駅?[・と](${JA_NAME})駅?(?=の間|間)`, "g"),
    needsContext: false,
  },
  // 大阪から京都まで。道順にも使う言い方なので、止まっていることを言う文に限る
  {
    pattern: new RegExp(`(${JA_NAME})駅?\\s*から\\s*(${JA_NAME})駅?(?=まで|の間|間)`, "g"),
    needsContext: true,
  },
];
const EN_NAME = "[A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*)*";
const EN_RANGE_PATTERNS: readonly { pattern: RegExp; needsContext: boolean }[] = [
  { pattern: new RegExp(`\\b(${EN_NAME})\\s*[–—]\\s*(${EN_NAME})`, "g"), needsContext: false },
  { pattern: new RegExp(`\\b(${EN_NAME}) - (${EN_NAME})`, "g"), needsContext: false },
  { pattern: new RegExp(`\\bfrom (${EN_NAME}) to (${EN_NAME})`, "g"), needsContext: true },
];
// 止まっている区間を言う文の手がかり
const STOPPED_CONTEXT: Record<Lang, RegExp> = {
  ja: /見合わせ|不通|運休|止ま|区間|動いて/,
  en: /suspen|stopped|halt|not running|section/i,
};
// 区間として言う手がかり。これがあれば「の間」でも位置ではなく区間とみなす
const SECTION_CLAIM: Record<Lang, RegExp> = {
  ja: /見合わせ|不通|運休|区間/,
  en: /suspen|section/i,
};

function findSentence(text: string, index: number): string {
  const start = Math.max(...[...".。!?！？\n"].map((c) => text.lastIndexOf(c, index - 1))) + 1;
  const ends = [...".。!?！？\n"].map((c) => text.indexOf(c, index)).filter((i) => i >= 0);
  return text.slice(start, ends.length > 0 ? Math.min(...ends) + 1 : text.length);
}

// 文から駅名の範囲を拾う。時刻や分の幅のように数字で接するものは除く
function listStationRanges(text: string, language: Lang): StationRange[] {
  const patterns = language === "ja" ? JA_RANGE_PATTERNS : EN_RANGE_PATTERNS;
  return patterns.flatMap(({ pattern, needsContext }) =>
    [...text.matchAll(pattern)].flatMap((m): StationRange[] => {
      const from = (m[1] ?? "").replace(/駅$/, "");
      const to = (m[2] ?? "").replace(/駅?間$/, "").replace(/駅$/, "");
      if (from === "" || to === "" || /\d$/.test(from) || /^\d/.test(to)) return [];
      const index = m.index ?? 0;
      const sentence = findSentence(text, index);
      if (needsContext && !STOPPED_CONTEXT[language].test(sentence)) return [];
      const after = text.slice(index + m[0].length);
      return [{ from, to, text: m[0], position: /^(駅)?の間/.test(after), sentence }];
    }),
  );
}

// 拾った範囲が 2 駅の組に当たるか。左は語の終わり、右は語の始まりで比べる。向きは問わない
function matchesPair(range: StationRange, a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const hit = (x: string, y: string) => range.from.endsWith(x) && range.to.startsWith(y);
  return hit(a, b) || hit(b, a);
}

// 発表に無い駅の範囲を、止まっている区間として書いていれば指摘する
// 発表の区間と、駅の間の車内の人がいる 2 駅を位置として言う文だけを許す
// 英語は駅名の表記が発表と揃わないため、発表に区間があれば検査しない
export function checkSectionWording(
  field: string,
  text: string,
  language: Lang,
  context: SectionWordingContext,
): string[] {
  const section = context.announcedSection;
  if (language === "en" && section) return [];
  const train = context.trainPosition;
  const found = listStationRanges(text, language).find((range) => {
    if (section && matchesPair(range, section.fromStation, section.toStation)) return false;
    const isPosition =
      range.position &&
      matchesPair(range, train?.previousStation ?? null, train?.nextStation ?? null) &&
      !SECTION_CLAIM[language].test(range.sentence);
    return !isPosition;
  });
  if (!found) return [];
  return [
    section
      ? `${field} の「${found.text}」は発表の区間と違う範囲です。止まっている区間は、発表の区間だけを書いてください`
      : `${field} の「${found.text}」は止まっている区間の言い方です。発表に区間が無いので、区間を書かないでください。区間は発表で確かめるよう画面が添えます`,
  ];
}

export type JudgmentCheckInput = {
  judgment: unknown;
  language: Lang;
  evidenceRefs: readonly Evidence[];
  allowedNumbers: AllowedNumbers;
  // core が勧める代替手段の id（分岐点の計算に使ったもの）。代替手段が無ければ null か省く
  recommendedAlternativeId?: string | null;
  // 駅間の車内の人なら、代替手段で乗る路線名。駅にいる人なら null か省く
  inCarAlternativeLines?: readonly string[] | null;
  // 止まり方。その列車だけが止まる事象では「見合わせ」と書かせない
  stopScope?: StopScope;
  // 発表の区間と利用者のいる 2 駅。発表に無い駅の範囲を書かせない。省くと検査しない
  sectionContext?: SectionWordingContext;
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
  const inCarLines = input.inCarAlternativeLines ?? null;
  // 利用者に見せる生成文。根拠の説明のうち、同じ種類と ID の根拠でサーバーが作った説明を一字一句写したものは
  // 発表の引用を含むので除く。別の根拠の ID に引用を付けたものは除かない
  const copiesServerDescription = (e: Evidence) =>
    input.evidenceRefs.some(
      (r) => r.kind === e.kind && r.id === e.id && r.description === e.description,
    );
  const shownTexts: [string, string][] = [
    ["headline", j.headline],
    ["reason", j.reason ?? ""],
    ["breakEven.explanation", j.breakEven?.explanation ?? ""],
    ...j.evidence.flatMap((e, i): [string, string][] =>
      copiesServerDescription(e) ? [] : [[`evidence[${i}].description`, e.description]],
    ),
  ];
  if (inCarLines !== null) {
    if (j.recommendedOptionId !== null) {
      errors.push("駅間の車内の人には recommendedOptionId を null にしてください");
    }
    for (const [field, text] of shownTexts) {
      errors.push(...checkInCarWording(field, text, input.language, inCarLines));
    }
  }
  if (input.stopScope === "train") {
    for (const [field, text] of shownTexts) {
      errors.push(...checkStopScopeWording(field, text, input.language));
    }
  }
  if (input.sectionContext) {
    for (const [field, text] of shownTexts) {
      errors.push(...checkSectionWording(field, text, input.language, input.sectionContext));
    }
  }
  const recommended = j.options.find((o) => o.id === j.recommendedOptionId);
  if (j.action === "switch" && recommended?.kind === "wait") {
    errors.push("action が switch のときは待つ以外の選択肢を推奨してください");
  }
  if (j.action === "wait" && recommended && recommended.kind !== "wait") {
    errors.push("action が wait のときは recommendedOptionId を待つ選択肢か null にしてください");
  }
  // 勧める代替手段は core が決める。タクシーは鉄道の代替が無いときと、期限に間に合わないときだけ
  if (
    j.action === "switch" &&
    input.recommendedAlternativeId &&
    j.recommendedOptionId !== input.recommendedAlternativeId
  ) {
    errors.push(
      `action が switch のときの recommendedOptionId は、compute_break_even が勧める代替手段 ${input.recommendedAlternativeId} にしてください。タクシーを勧めるのは、鉄道の代替が無いときと、鉄道の代替では期限に間に合わないときだけです`,
    );
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
