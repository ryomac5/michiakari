import {
  detectAnnouncementCues,
  findIncidentTypeByPhrase,
  INCIDENT_PHRASES,
  type IncidentTypeId,
} from "@repo/core";
import type { AnnouncementCueId } from "@repo/schema";

// 発表と放送の文を、core の呼び名の表と手がかりの表で照合する。決定論モードの解釈と根拠の引用に使う

// 文に分ける。句点と改行で区切り、句点は文に残す
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。．!！?？])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type IncidentPhraseMatch = {
  type: IncidentTypeId;
  // 呼び名を含む文
  quote: string;
};

// 文章の中で最初に呼び名が見つかる文から、起きていることの種類を決める。無ければ null
export function matchIncidentPhrase(text: string): IncidentPhraseMatch | null {
  for (const sentence of splitSentences(text)) {
    const type = findIncidentTypeByPhrase(sentence);
    if (type) return { type, quote: sentence };
  }
  return null;
}

// 指定の種類の呼び名を含む最初の文。無ければ null
export function findIncidentQuote(text: string, type: IncidentTypeId): string | null {
  return (
    splitSentences(text).find((s) => INCIDENT_PHRASES[type].some((p) => s.includes(p))) ?? null
  );
}

export type CueMatch = {
  cueId: AnnouncementCueId;
  // 手がかりを含む文
  quote: string;
};

// 文章に現れる手がかりを、最初に現れた文とともに返す。同じ手がかりは 1 度だけ
export function matchCueSentences(text: string): CueMatch[] {
  const found = new Map<AnnouncementCueId, string>();
  for (const sentence of splitSentences(text)) {
    for (const cueId of detectAnnouncementCues(sentence)) {
      if (!found.has(cueId)) found.set(cueId, sentence);
    }
  }
  return [...found].map(([cueId, quote]) => ({ cueId, quote }));
}
