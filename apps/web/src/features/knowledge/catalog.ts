import type { Knowledge, KnowledgePhase, KnowledgeSignal } from "@repo/schema";

// 画面が表示に使う知見の抜粋。段階名・兆候の説明・聞こえる案内の例だけを持つ

export type CatalogSignal = Pick<KnowledgeSignal, "id" | "description" | "example_phrases">;
export type CatalogPhase = Pick<KnowledgePhase, "id" | "name"> & { signals: CatalogSignal[] };
export type CatalogEvent = Pick<Knowledge, "id" | "name"> & { phases: CatalogPhase[] };
export type KnowledgeCatalog = CatalogEvent[];

export function buildCatalogEvent(knowledge: Knowledge): CatalogEvent {
  return {
    id: knowledge.id,
    name: knowledge.name,
    phases: knowledge.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      signals: phase.signals.map(({ id, description, example_phrases }) => ({
        id,
        description,
        example_phrases,
      })),
    })),
  };
}

// 先に並んだものを優先して、id が重複しないように結合する
export function mergeCatalogs(
  primary: KnowledgeCatalog,
  fallback: KnowledgeCatalog,
): KnowledgeCatalog {
  const known = new Set(primary.map((e) => e.id));
  return [...primary, ...fallback.filter((e) => !known.has(e.id))];
}

export function findCatalogEvent(
  catalog: KnowledgeCatalog,
  eventType: string | null,
): CatalogEvent | undefined {
  return eventType === null ? undefined : catalog.find((e) => e.id === eventType);
}

export function findCatalogSignal(
  catalog: KnowledgeCatalog,
  eventType: string,
  signalId: string,
): CatalogSignal | undefined {
  return findCatalogEvent(catalog, eventType)
    ?.phases.flatMap((p) => p.signals)
    .find((s) => s.id === signalId);
}

export function pickLocalized(text: { ja: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ja;
}
