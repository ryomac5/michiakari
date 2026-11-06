import type { Knowledge, Lang } from "@repo/schema";

// 利用者に見せる文の検査。判断の文と、判断の途中に流す進み具合の文の両方に使う
// 再開の見込みは画面の見込みの図で幅を持たせて示すので、文では再開までの時間を言い切らない

// 事象に決まった流れがあるように語る言い方
const MODIFIERS_JA =
  "ふつう|通常|たいてい|普段|ふだん|だいたい|おおむね|多くの場合|一般に|一般的に";
// 再開の言い方の揺れ。「運転を再開」「再開されます」「動き出す」「復旧」「終わる」
const RESUME_JA = "(?:運転[をが]?)?(?:再開|動き出|動きだ|復旧|終わ|おわ)";
// 時間の長さ。「1時間」「1時間30分」「5〜10分」「半日」。時刻の「23時40分」は含めない
const NUMBER_JA = "[0-9０-９一二三四五六七八九十数]+";
const DURATION_JA = `(?:約|およそ)?${NUMBER_JA}(?:時間半?(?:${NUMBER_JA}分)?|分)(?:[〜~～-]${NUMBER_JA}(?:時間|分)?)?`;
const APPROX_JA = "(?:ほど|くらい|ぐらい|程度|前後|弱|強|あまり)?";

const FLOW_WORDING_PATTERNS: Record<Lang, RegExp[]> = {
  ja: [
    /よくある流れ|典型的な流れ|決まった流れ/,
    // 修飾の言葉のあと、同じ文の中で再開を語る
    new RegExp(`(?:${MODIFIERS_JA})[^。]*?${RESUME_JA}`),
    // 時間の長さで再開を言い切る。「1時間ほどで運転を再開」
    new RegExp(`${DURATION_JA}${APPROX_JA}(?:で|後に|のうちに|以内に)${RESUME_JA}`),
    // 「再開までは1時間ほどかかる」
    new RegExp(`${RESUME_JA}(?:する|して)?まで(?:に)?(?:は)?${DURATION_JA}${APPROX_JA}(?:かか|要)`),
  ],
  en: [
    /typical (?:flow|pattern)/i,
    /\b(?:usually|normally|typically|generally|in most cases|most of the time)\b[^.]*?\b(?:resum|restart|start(?:s|ing)? moving|recover|over\b|clear)/i,
    /\b(?:resum|restart|recover)\w*\b[^.]*?\b(?:in|within|after) (?:about |around |roughly )?\d+(?:\s*[–-]\s*\d+)?\s*(?:min|minutes?|h|hours?)\b/i,
    /\btakes? (?:about |around |roughly )?\d+(?:\s*[–-]\s*\d+)?\s*(?:min|minutes?|h|hours?)\b[^.]*?\b(?:resum|restart|recover)/i,
  ],
};

export function findFlowWording(text: string, language: Lang): string | null {
  for (const pattern of FLOW_WORDING_PATTERNS[language]) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

// 内部の名前。snake_case の id、camelCase の項目名、p50 と p80 のような統計の記号
const INTERNAL_NAME_PATTERN =
  /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\bp[0-9]{2}\b/;

export function findInternalWording(text: string): string | null {
  return INTERNAL_NAME_PATTERN.exec(text)?.[0] ?? null;
}

// 知見の本文は利用者に出さない。文に写していれば、その文を返す
const MIN_KNOWLEDGE_SENTENCE_LENGTH = 10;

export function collectKnowledgeSentences(knowledge: Iterable<Knowledge>): string[] {
  const texts: string[] = [];
  for (const k of knowledge) {
    texts.push(...Object.values(k.summary), ...k.caveats, k.after_resume.notes);
    texts.push(k.external_factors.notes, ...Object.values(k.predictability?.basis ?? {}));
    for (const phase of k.phases) {
      texts.push(phase.description, ...Object.values(phase.guidance));
      texts.push(...phase.signals.map((s) => s.description));
    }
  }
  const sentences = texts
    .filter((t): t is string => typeof t === "string")
    .flatMap((t) => t.split(/(?<=[。.!?])\s*/))
    .map((t) => t.trim().replace(/[。.!?]$/, ""))
    .filter((t) => [...t].length >= MIN_KNOWLEDGE_SENTENCE_LENGTH);
  return [...new Set(sentences)];
}

export function findKnowledgeText(text: string, sentences: readonly string[]): string | null {
  return sentences.find((s) => text.includes(s)) ?? null;
}
