import type { DetectedSignal, Evidence } from "@repo/schema";
import {
  findCatalogEvent,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";

// 根拠の項目に出す文の材料。知見の本文は利用者に出さないので、兆候と知見の項目は
// 発表の引用と、事象・段階の名前から組み立てる。気象と計算は agent が数値から作った文をそのまま使う
export type EvidenceText =
  | { key: "signal"; values: { quote: string } }
  | { key: "event"; values: { event: string } }
  | { key: "phase"; values: { phase: string } }
  | { key: "knowledge"; values: Record<string, never> }
  | { key: "raw"; text: string };

export function selectEvidenceText(
  item: Evidence,
  context: {
    catalog: KnowledgeCatalog;
    eventType: string | null;
    signals: readonly DetectedSignal[];
    locale: string;
  },
): EvidenceText {
  if (item.kind === "signal") {
    const quote = context.signals.find((s) => s.signalId === item.id)?.quote;
    return quote ? { key: "signal", values: { quote } } : { key: "knowledge", values: {} };
  }
  if (item.kind === "knowledge") {
    const event = findCatalogEvent(context.catalog, context.eventType);
    if (event?.id === item.id) {
      return { key: "event", values: { event: pickLocalized(event.name, context.locale) } };
    }
    const phase = event?.phases.find((p) => p.id === item.id);
    if (phase)
      return { key: "phase", values: { phase: pickLocalized(phase.name, context.locale) } };
    return { key: "knowledge", values: {} };
  }
  return { key: "raw", text: item.description };
}
