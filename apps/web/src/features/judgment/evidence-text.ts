import { detectAnnouncementCues, findIncidentTypeByPhrase } from "@repo/core";
import type { AnnouncementCueId, DetectedSignal, Estimate, Observation } from "@repo/schema";

// 根拠の欄の項目。利用者が聞いた言葉と、手がかりがあればそこから読める一般的な読みを組にする
// 事象の段階の名前は出さない。id は属性にだけ載せ、文には入れない

export const evidenceLimit = 3;

// 行動を変える放送の手がかり。並びは読みを選ぶ優先の順
export const cueIds = [
  "evacuation_on_track",
  "resumed",
  "resume_soon",
  "track_cleared",
  "inspection_ongoing",
  "proceed_to_station",
  "queue_ahead",
  "protection_received",
  "turnback",
  "through_service_suspended",
  "service_cancelled",
  "held_at_station",
  "slow_running",
  "rescue",
] as const satisfies readonly AnnouncementCueId[];
export type CueId = AnnouncementCueId;

export type EvidenceEntry = {
  // 兆候の id か、入口で選んだ原因を表す "cause"。testid と属性にだけ使う
  id: string;
  // 聞いた言葉。発表の引用か、入口で選んだ原因の呼び名。手がかりだけが分かり言葉が無ければ null
  heard: string | null;
  // この項目から読める手がかり。無ければ null
  cueId: CueId | null;
  // この項目にまとめた兆候の id。同じ引用の言葉は 1 項目にまとめる。属性にだけ使う
  signalIds?: string[];
};

export type EvidenceLine = {
  id: string;
  signalIds: string[];
  cueId: CueId | null;
  heard: string | null;
  reading: string | null;
};

type Translate = (key: string, values?: Record<string, string>) => string;

// 手がかりの id の並びから、行動を変える読みを 1 つ選ぶ。手がかりが無ければ null
export function selectCueReading(ids: readonly string[]): CueId | null {
  return cueIds.find((id) => ids.includes(id)) ?? null;
}

// 判断の結果が点検の続く間として再開の近い手がかりを除いたら、その読みを出さない
export function excludeInspectedCues(
  ids: readonly string[],
  judged: readonly AnnouncementCueId[] | undefined,
): string[] {
  if (!judged?.includes("inspection_ongoing")) return [...ids];
  const dropped = (["resume_soon", "track_cleared"] as const).filter((id) => !judged.includes(id));
  return ids.filter((id) => !(dropped as readonly string[]).includes(id));
}

// 引用は最初の 1 文だけにして短くする
function shortenQuote(quote: string): string {
  const first = quote
    .trim()
    .match(/^.*?(?:。|[.!?](?=\s|$)|$)/s)?.[0]
    ?.trim();
  return first || quote.trim();
}

// 判断の手がかりを含む観測の文を、新しいものから探す。無ければ null
function findCueQuote(observations: readonly Observation[], cue: CueId): string | null {
  const text = observations
    .map((o) => o.rawText ?? "")
    .findLast((t) => detectAnnouncementCues(t).includes(cue));
  return text ? shortenQuote(text) : null;
}

// 聞いた言葉から根拠の項目を選ぶ。新しい言葉を先に、同じ引用は 1 つにまとめ、最大 3 つにする
// 手がかりの読みは、最も優先する手がかりを含む項目 1 つにだけ付ける
// 判断の結果の手がかりが引用に無ければ、その手がかりを含む観測の文を先頭に足す
export function selectEvidenceEntries(context: {
  estimate: Estimate | null;
  signals: readonly DetectedSignal[];
  // 入口で選んだ原因の呼び名。発表の引用が無いときの聞いた言葉にする
  heardCause?: string | null;
  // 判断の結果が観測から拾った手がかり
  cues?: readonly AnnouncementCueId[];
  // 判断に使った観測。手がかりを含む文を聞いた言葉にする
  observations?: readonly Observation[];
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

  const cue = selectCueReading(
    excludeInspectedCues(
      [...distinct.flatMap((s) => s.signalIds), ...(context.cues ?? [])],
      context.cues,
    ),
  );
  const cueIndex = cue === null ? -1 : distinct.findIndex((s) => s.signalIds.includes(cue));
  const entries: EvidenceEntry[] = distinct.map((s, index) => ({
    ...s,
    cueId: index === cueIndex ? cue : null,
  }));
  if (cue !== null && cueIndex === -1) return addCueEntry(entries, cue, context);
  if (entries.length > 0) return entries;

  // 発表の引用が無く原因だけを選んだときは、選んだ原因を聞いた言葉にする
  if (context.heardCause) {
    return [{ id: "cause", signalIds: [], heard: context.heardCause, cueId: null }];
  }
  // 手がかりを含まない発表だけのときは、いちばん新しい観測の文を聞いた言葉にする
  const latest = findLatestQuote(context.observations ?? []);
  return latest === null ? [] : [{ id: "observation", signalIds: [], heard: latest, cueId: null }];
}

// 文のある観測のうち、いちばん新しいものから 1 文を選ぶ。事象の名前を含む文を先に選ぶ。無ければ null
function findLatestQuote(observations: readonly Observation[]): string | null {
  const text = observations.map((o) => o.rawText?.trim() ?? "").findLast((t) => t.length > 0);
  if (!text) return null;
  const sentences = text.match(/[^。]+。?/g)?.map((s) => s.trim()) ?? [];
  return sentences.find((s) => findIncidentTypeByPhrase(s) !== null) ?? shortenQuote(text);
}

// 引用に無い手がかりの読みを足す。手がかりを含む観測の文があれば先頭の項目にする
// 文が無ければ、いちばん新しい項目か入口の原因に読みを添える。どれも無ければ言葉の無い項目にする
function addCueEntry(
  entries: readonly EvidenceEntry[],
  cue: CueId,
  context: { heardCause?: string | null; observations?: readonly Observation[] },
): EvidenceEntry[] {
  const quote = findCueQuote(context.observations ?? [], cue);
  if (quote !== null) {
    const rest = entries.filter((e) => e.heard !== quote);
    const added: EvidenceEntry = { id: cue, signalIds: [cue], heard: quote, cueId: cue };
    return [added, ...rest].slice(0, evidenceLimit);
  }
  const [first, ...rest] = entries;
  if (first) return [{ ...first, cueId: cue }, ...rest];
  const heard = context.heardCause ?? null;
  return [{ id: heard === null ? cue : "cause", signalIds: [cue], heard, cueId: cue }];
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
    heard: entry.heard === null ? null : t("heardQuote", { quote: entry.heard }),
    reading: entry.cueId === null ? null : t(`cue.${entry.cueId}`),
  }));
}
