import type { Evidence } from "@repo/schema";
import { findCatalogEvent, findCatalogSignal, type KnowledgeCatalog } from "./catalog";

// 知見の閲覧画面（/knowledge）の見出しに付ける id と、根拠からそこへ飛ぶリンク

export const knowledgePath = "/knowledge";

export function buildSignalAnchor(signalId: string): string {
  return `signal-${signalId}`;
}

export function buildEventAnchor(eventId: string): string {
  return `event-${eventId}`;
}

export function buildPhaseAnchor(eventId: string, phaseId: string): string {
  return `phase-${eventId}-${phaseId}`;
}

export function buildSignalHref(signalId: string): string {
  return `${knowledgePath}#${buildSignalAnchor(signalId)}`;
}

// 根拠の項目に対応する知見の箇所。知見に無いもの（計算・気象）は null
export function buildEvidenceHref(
  evidence: Evidence,
  eventType: string | null,
  catalog: KnowledgeCatalog,
): string | null {
  if (eventType === null) return null;
  if (evidence.kind === "signal") {
    return findCatalogSignal(catalog, eventType, evidence.id) ? buildSignalHref(evidence.id) : null;
  }
  if (evidence.kind !== "knowledge") return null;
  const event = findCatalogEvent(catalog, eventType);
  if (!event) return null;
  if (evidence.id === event.id) return `${knowledgePath}#${buildEventAnchor(event.id)}`;
  const phase = event.phases.find((p) => p.id === evidence.id);
  return phase ? `${knowledgePath}#${buildPhaseAnchor(event.id, phase.id)}` : null;
}
