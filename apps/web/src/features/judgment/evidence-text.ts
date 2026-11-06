import type { DetectedSignal, Estimate } from "@repo/schema";
import {
  findCatalogEvent,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";

// 根拠の欄の項目。利用者が聞いた言葉と、そこから読めるいまの段階を組にする
// 知見の本文は出さず、発表の引用と段階の名前だけを使う。id は属性にだけ載せ、文には入れない

export const evidenceLimit = 3;

export type EvidenceEntry = {
  // 兆候の id か事象の id。testid と属性にだけ使う
  id: string;
  // 聞いた言葉。発表の引用か、入口で選んだ原因の呼び名
  heard: string;
  phaseId: string | null;
  phaseName: string | null;
  // いまの段階を指すか
  current: boolean;
};

export type EvidenceLine = {
  id: string;
  phaseId: string | null;
  current: boolean;
  heard: string;
  reading: string;
};

type Translate = (key: string, values?: Record<string, string>) => string;

// 引用は最初の 1 文だけにして短くする
function shortenQuote(quote: string): string {
  const first = quote
    .trim()
    .match(/^.*?(?:。|[.!?](?=\s|$)|$)/s)?.[0]
    ?.trim();
  return first || quote.trim();
}

// 聞いた言葉から根拠の項目を選ぶ。いまの段階の言葉を先に、新しい言葉を先に並べる
// 同じ引用と同じ段階は、新しい言葉 1 つにまとめ、最大 3 つにする
export function selectEvidenceEntries(context: {
  catalog: KnowledgeCatalog;
  estimate: Estimate | null;
  signals: readonly DetectedSignal[];
  locale: string;
  // 入口で選んだ原因の呼び名。発表の引用が無いときの聞いた言葉にする
  heardCause?: string | null;
}): EvidenceEntry[] {
  const { catalog, estimate, signals, locale } = context;
  const eventType = estimate?.eventType ?? null;
  const event = findCatalogEvent(catalog, eventType);
  const currentPhaseId = estimate?.phaseId ?? null;
  const nameOf = (phaseId: string | null) => {
    const phase = event?.phases.find((p) => p.id === phaseId);
    return phase ? pickLocalized(phase.name, locale) : null;
  };

  const quoted = signals
    .filter((s) => eventType === null || s.eventType === eventType)
    .map((s) => {
      const phaseId =
        event?.phases.find((p) => p.signals.some((k) => k.id === s.signalId))?.id ?? null;
      return { id: s.signalId, heard: shortenQuote(s.quote), phaseId };
    })
    .filter((s) => s.heard.length > 0)
    .reverse();

  const seenQuotes = new Set<string>();
  const seenPhases = new Set<string | null>();
  const unique = quoted.filter((s) => {
    if (seenQuotes.has(s.heard) || seenPhases.has(s.phaseId)) return false;
    seenQuotes.add(s.heard);
    seenPhases.add(s.phaseId);
    return true;
  });
  const ordered = [
    ...unique.filter((s) => s.phaseId !== null && s.phaseId === currentPhaseId),
    ...unique.filter((s) => s.phaseId === null || s.phaseId !== currentPhaseId),
  ];

  const entries: EvidenceEntry[] = ordered.slice(0, evidenceLimit).map((s) => ({
    ...s,
    phaseName: nameOf(s.phaseId),
    current: s.phaseId !== null && s.phaseId === currentPhaseId,
  }));

  // いまの段階の言葉が無ければ、最も新しい言葉からいまの段階を読む
  const first = entries[0];
  if (first && !first.current && currentPhaseId !== null && nameOf(currentPhaseId) !== null) {
    entries[0] = {
      ...first,
      phaseId: currentPhaseId,
      phaseName: nameOf(currentPhaseId),
      current: true,
    };
  }
  if (entries.length > 0 || !event) return entries;

  // 発表の引用が無く原因だけを選んだときは、選んだ原因を聞いた言葉にする
  return [
    {
      id: event.id,
      heard: context.heardCause ?? pickLocalized(event.name, locale),
      phaseId: currentPhaseId,
      phaseName: nameOf(currentPhaseId),
      current: currentPhaseId !== null,
    },
  ];
}

// 次の段階の兆候を、放送で聞こえる言い回しの例で返す。知見の説明の文は使わない
// 例は日本語だけなので、英語の画面では空にする。根拠の欄と次に確かめることの欄が同じ並びを引く
export function listNextSignalPhrases(
  catalog: KnowledgeCatalog,
  estimate: Estimate | null,
  locale: string,
): string[] {
  if (locale === "en" || !estimate) return [];
  const event = findCatalogEvent(catalog, estimate.eventType);
  if (!event) return [];
  const index = event.phases.findIndex((p) => p.id === estimate.phaseId);
  const next = event.phases[index + 1];
  return (next?.signals ?? []).flatMap((s) => (s.example_phrases[0] ? [s.example_phrases[0]] : []));
}

// 項目を画面の 2 行の文にする。t は judgment.evidence の訳を引く
export function buildEvidenceLines(
  entries: readonly EvidenceEntry[],
  t: Translate,
): EvidenceLine[] {
  return entries.map((entry) => ({
    id: entry.id,
    phaseId: entry.phaseId,
    current: entry.current,
    heard: t("heardQuote", { quote: entry.heard }),
    reading:
      entry.phaseName === null
        ? t("reading.unknown")
        : entry.current
          ? t("reading.current", { phase: entry.phaseName })
          : t("reading.entered", { phase: entry.phaseName }),
  }));
}
