import type { DetectedSignal, Estimate } from "@repo/schema";

// 根拠の欄の項目。利用者が聞いた言葉と、手がかりがあればそこから読める一般的な読みを組にする
// 事象の段階の名前は出さない。id は属性にだけ載せ、文には入れない

export const evidenceLimit = 3;

// 行動を変える放送の手がかり。並びは読みを選ぶ優先の順
export const cueIds = [
  "resumed",
  "resume_soon",
  "track_cleared",
  "queue_ahead",
  "protection_received",
  "rescue",
] as const;
export type CueId = (typeof cueIds)[number];

export type EvidenceEntry = {
  // 兆候の id か、入口で選んだ原因を表す "cause"。testid と属性にだけ使う
  id: string;
  // 聞いた言葉。発表の引用か、入口で選んだ原因の呼び名
  heard: string;
  // この項目から読める手がかり。無ければ null
  cueId: CueId | null;
  // この項目にまとめた兆候の id。同じ引用の言葉は 1 項目にまとめる。属性にだけ使う
  signalIds?: string[];
};

export type EvidenceLine = {
  id: string;
  signalIds: string[];
  cueId: CueId | null;
  heard: string;
  reading: string | null;
};

type Translate = (key: string, values?: Record<string, string>) => string;

// 手がかりの id の並びから、行動を変える読みを 1 つ選ぶ。手がかりが無ければ null
export function selectCueReading(ids: readonly string[]): CueId | null {
  return cueIds.find((id) => ids.includes(id)) ?? null;
}

// 引用は最初の 1 文だけにして短くする
function shortenQuote(quote: string): string {
  const first = quote
    .trim()
    .match(/^.*?(?:。|[.!?](?=\s|$)|$)/s)?.[0]
    ?.trim();
  return first || quote.trim();
}

// 聞いた言葉から根拠の項目を選ぶ。新しい言葉を先に、同じ引用は 1 つにまとめ、最大 3 つにする
// 手がかりの読みは、最も優先する手がかりを含む項目 1 つにだけ付ける
export function selectEvidenceEntries(context: {
  estimate: Estimate | null;
  signals: readonly DetectedSignal[];
  // 入口で選んだ原因の呼び名。発表の引用が無いときの聞いた言葉にする
  heardCause?: string | null;
}): EvidenceEntry[] {
  const eventType = context.estimate?.eventType ?? null;
  const quoted = context.signals
    .filter((s) => eventType === null || s.eventType === eventType)
    .map((s) => ({ id: s.signalId, heard: shortenQuote(s.quote) }))
    .filter((s) => s.heard.length > 0)
    .reverse();

  // 同じ引用は 1 つにまとめる。その引用に入っていた兆候の id はすべて残す
  const distinct = quoted
    .flatMap((s, index) => {
      if (quoted.findIndex((t) => t.heard === s.heard) !== index) return [];
      const signalIds = quoted.filter((t) => t.heard === s.heard).map((t) => t.id);
      return [{ ...s, signalIds }];
    })
    .slice(0, evidenceLimit);

  const cue = selectCueReading(distinct.flatMap((s) => s.signalIds));
  const cueIndex = cue === null ? -1 : distinct.findIndex((s) => s.signalIds.includes(cue));
  const entries: EvidenceEntry[] = distinct.map((s, index) => ({
    ...s,
    cueId: index === cueIndex ? cue : null,
  }));
  if (entries.length > 0 || !context.heardCause) return entries;

  // 発表の引用が無く原因だけを選んだときは、選んだ原因を聞いた言葉にする
  return [{ id: "cause", signalIds: [], heard: context.heardCause, cueId: null }];
}

// 項目を画面の文にする。読みは手がかりがある項目だけに付ける。t は judgment.evidence の訳を引く
export function buildEvidenceLines(
  entries: readonly EvidenceEntry[],
  t: Translate,
): EvidenceLine[] {
  return entries.map((entry) => ({
    id: entry.id,
    signalIds: entry.signalIds ?? [],
    cueId: entry.cueId,
    heard: t("heardQuote", { quote: entry.heard }),
    reading: entry.cueId === null ? null : t(`cue.${entry.cueId}`),
  }));
}
