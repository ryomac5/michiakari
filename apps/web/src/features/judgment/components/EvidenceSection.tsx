"use client";

import type { DetectedSignal, Estimate, Evidence } from "@repo/schema";
import {
  BookOpen,
  Calculator,
  ChevronDown,
  CloudRain,
  type LucideIcon,
  MapPin,
  Radio,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  findCatalogEvent,
  findCatalogSignal,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";
import { testIds } from "../testids";

const evidenceIcons: Record<Evidence["kind"], LucideIcon> = {
  signal: Radio,
  knowledge: BookOpen,
  weather: CloudRain,
  computation: Calculator,
};

// 根拠は見たい人だけが開ける。既定は閉
export function EvidenceSection({
  estimate,
  signals,
  evidence,
  catalog,
}: {
  estimate: Estimate | null;
  signals: DetectedSignal[];
  evidence: Evidence[];
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.evidence");

  return (
    <Collapsible
      data-testid={testIds.judgment.evidence}
      className="group rounded-3xl border-2 border-border bg-surface"
    >
      <CollapsibleTrigger
        data-testid={testIds.judgment.evidenceToggle}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left text-lg font-extrabold"
      >
        {t("title")}
        <ChevronDown
          className="size-6 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 px-5 pb-5">
        <PhaseTimeline estimate={estimate} catalog={catalog} />
        <SignalList signals={signals} catalog={catalog} />
        {evidence.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-extrabold">{t("items")}</h3>
            <ul className="flex flex-col gap-2">
              {evidence.map((item) => {
                const Icon = evidenceIcons[item.kind];
                return (
                  <li
                    key={`${item.kind}-${item.id}`}
                    data-testid={testIds.judgment.evidenceItem(item.id)}
                    className="flex items-start gap-3 rounded-xl bg-surface-raised p-3"
                  >
                    <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-bold text-muted">
                        {t(`kinds.${item.kind}`)} · <code className="font-mono">{item.id}</code>
                      </p>
                      <p>{item.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function PhaseTimeline({
  estimate,
  catalog,
}: {
  estimate: Estimate | null;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.evidence");
  const locale = useLocale();
  const event = findCatalogEvent(catalog, estimate?.eventType ?? null);
  const phases = event?.phases ?? [];
  const currentIndex = phases.findIndex((p) => p.id === estimate?.phaseId);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-extrabold">
        {t("phases")}
        {event && (
          <span className="ml-2 font-bold text-muted">{pickLocalized(event.name, locale)}</span>
        )}
      </h3>
      {estimate?.phaseId == null && <p className="text-muted">{t("unknownPhase")}</p>}
      {estimate?.phaseId != null && phases.length === 0 && (
        <p className="font-bold">
          <code className="font-mono">{estimate.phaseId}</code>
        </p>
      )}
      {phases.length > 0 && (
        <ol data-testid={testIds.judgment.phaseTimeline} className="flex flex-col">
          {phases.map((phase, i) => {
            const position = i < currentIndex ? "past" : i === currentIndex ? "current" : "future";
            return (
              <li
                key={phase.id}
                data-testid={testIds.judgment.phase(phase.id)}
                data-position={position}
                aria-current={position === "current" ? "step" : undefined}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1 flex size-4 shrink-0 rounded-full border-2",
                      position === "past" && "border-muted bg-muted",
                      position === "current" && "size-5 border-foreground bg-foreground",
                      position === "future" && "border-border border-dashed",
                    )}
                  />
                  {i < phases.length - 1 && (
                    <span
                      className={cn(
                        "mt-1 w-0.5 flex-1",
                        position === "past" ? "bg-muted" : "border-l-2 border-dashed border-border",
                      )}
                    />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p
                    className={cn(
                      "flex flex-wrap items-center gap-2",
                      position === "current" ? "text-lg font-extrabold" : "text-muted",
                    )}
                  >
                    {pickLocalized(phase.name, locale)}
                    {position === "current" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-sm font-bold text-background">
                        <MapPin className="size-3.5" aria-hidden />
                        {t("here")}
                      </span>
                    )}
                  </p>
                  {position === "current" && estimate?.elapsedMinutes != null && (
                    <p className="text-sm text-muted">
                      {t("elapsed", { minutes: estimate.elapsedMinutes })}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function SignalList({
  signals,
  catalog,
}: {
  signals: DetectedSignal[];
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.evidence");

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-extrabold">{t("signals")}</h3>
      {signals.length === 0 && <p className="text-muted">{t("noSignals")}</p>}
      <ul className="flex flex-col gap-2">
        {signals.map((signal) => {
          const known = findCatalogSignal(catalog, signal.eventType, signal.signalId);
          return (
            <li
              key={`${signal.eventType}-${signal.signalId}`}
              data-testid={testIds.judgment.signal(signal.signalId)}
              className="flex items-start gap-3 rounded-xl bg-surface-raised p-3"
            >
              <Radio className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-bold">「{signal.quote}」</p>
                {known && <p className="text-sm">{known.description}</p>}
                <code className="font-mono text-sm text-muted">{signal.signalId}</code>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
