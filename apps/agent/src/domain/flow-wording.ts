import type { Lang } from "@repo/schema";

// 事象に決まった流れがあるように語る言い方と、再開までの時間を文で言い切る言い方
// 再開の見込みは画面の見込みの図で幅を持たせて示すので、見出し・理由・根拠には書かない
const FLOW_WORDING_PATTERNS: Record<Lang, RegExp> = {
  ja: /よくある流れ|典型的な流れ|ふつう|たいてい|[0-9０-９一二三四五六七八九十]+(?:[〜~][0-9０-９]+)?(?:時間|分)(?:[0-9０-９]+分)?(?:ほど|くらい|ぐらい|程度)で(?:再開|終わ|動)/,
  en: /typical flow|usually (?:resum|over|take|end)|normally (?:resum|take)|typically (?:resum|take)/i,
};

export function findFlowWording(text: string, language: Lang): string | null {
  return FLOW_WORDING_PATTERNS[language].exec(text)?.[0] ?? null;
}
