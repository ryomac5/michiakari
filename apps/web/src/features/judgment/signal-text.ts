import {
  findCatalogEvent,
  findCatalogSignal,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";

// 兆候の補足文。知見の説明の文は利用者に出さず、兆候が属する段階の名前で組み立てる
export function buildSignalNote(
  catalog: KnowledgeCatalog,
  eventType: string,
  signalId: string,
  locale: string,
): string | null {
  if (!findCatalogSignal(catalog, eventType, signalId)) return null;
  const phase = findCatalogEvent(catalog, eventType)?.phases.find((p) =>
    p.signals.some((s) => s.id === signalId),
  );
  if (!phase) return null;
  const name = pickLocalized(phase.name, locale);
  return locale === "en" ? `Seen in the "${name}" phase` : `「${name}」の段階の兆候`;
}
