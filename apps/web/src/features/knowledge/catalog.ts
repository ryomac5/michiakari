import type { Knowledge, KnowledgePhase, KnowledgeSignal } from "@repo/schema";

// 知見の抜粋の型。画面には配らない。入口の原因の表が型だけを使う
// TODO: 入口が原因の表だけで事象を決めるようになったら、このファイルごと外す

export type CatalogSignal = Pick<KnowledgeSignal, "id" | "description" | "example_phrases">;
export type CatalogPhase = Pick<KnowledgePhase, "id" | "name"> & { signals: CatalogSignal[] };
export type CatalogEvent = Pick<Knowledge, "id" | "name"> & { phases: CatalogPhase[] };
export type KnowledgeCatalog = CatalogEvent[];
