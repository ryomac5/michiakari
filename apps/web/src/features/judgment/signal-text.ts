import {
  findCatalogEvent,
  findCatalogSignal,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";

// 兆候の補足文。知見の説明は日本語だけなので、英語では段階の英語名から組み立てる
export function buildSignalNote(
  catalog: KnowledgeCatalog,
  eventType: string,
  signalId: string,
  locale: string,
): string | null {
  const signal = findCatalogSignal(catalog, eventType, signalId);
  if (!signal) return null;
  if (locale !== "en") return signal.description;
  const phase = findCatalogEvent(catalog, eventType)?.phases.find((p) =>
    p.signals.some((s) => s.id === signalId),
  );
  return phase ? `Seen in the "${pickLocalized(phase.name, locale)}" phase` : null;
}
