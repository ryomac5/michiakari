"use client";

import type { Estimate } from "@repo/schema";
import { MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";
import {
  findCatalogEvent,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";

// 事象の段階を横一列に並べ、いまの段階に「いまここ」を付ける。根拠を開かなくても見える
export function PhaseStrip({
  estimate,
  catalog,
}: {
  estimate: Estimate | null;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("replay");
  const locale = useLocale();
  const event = findCatalogEvent(catalog, estimate?.eventType ?? null);
  const phases = event?.phases ?? [];
  const currentIndex = phases.findIndex((p) => p.id === estimate?.phaseId);

  return (
    <section
      data-testid={testIds.replay.phaseStrip}
      data-phase-id={estimate?.phaseId ?? ""}
      aria-labelledby="replay-phases-title"
      className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-4"
    >
      <h2 id="replay-phases-title" className="flex items-baseline gap-2 font-extrabold">
        {t("phases")}
        {event && (
          <span className="text-sm font-bold text-muted">{pickLocalized(event.name, locale)}</span>
        )}
      </h2>
      {phases.length === 0 && (
        <p className="text-muted">
          {estimate?.phaseId ? (
            <code className="font-mono">{estimate.phaseId}</code>
          ) : (
            t("unknownPhase")
          )}
        </p>
      )}
      {phases.length > 0 && (
        <ol className="flex gap-1">
          {phases.map((phase, i) => {
            const position = i < currentIndex ? "past" : i === currentIndex ? "current" : "future";
            return (
              <li
                key={phase.id}
                data-testid={testIds.replay.phase(phase.id)}
                data-position={position}
                aria-current={position === "current" ? "step" : undefined}
                className="flex min-w-0 flex-1 flex-col gap-1.5"
              >
                <span
                  className={cn(
                    "h-2 rounded-full transition-colors duration-500",
                    position === "past" && "bg-muted",
                    position === "current" && "bg-foreground",
                    position === "future" && "bg-surface-raised",
                  )}
                />
                <span
                  className={cn(
                    "text-xs leading-tight break-words",
                    position === "current" ? "font-extrabold" : "text-muted",
                  )}
                >
                  {pickLocalized(phase.name, locale)}
                </span>
                {position === "current" && (
                  <span className="inline-flex w-fit animate-step-in items-center gap-0.5 rounded-full bg-foreground px-1.5 py-0.5 text-[11px] font-bold text-background">
                    <MapPin className="size-3" aria-hidden />
                    {t("here")}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
