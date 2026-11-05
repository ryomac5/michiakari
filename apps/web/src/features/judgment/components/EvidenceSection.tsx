"use client";

import type { DetectedSignal, Estimate, Evidence } from "@repo/schema";
import {
  ArrowUpRight,
  BookOpen,
  Calculator,
  ChevronDown,
  CloudRain,
  type LucideIcon,
  MapPin,
  Radio,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { buildEvidenceHref, buildSignalHref } from "@/features/knowledge/anchors";
import {
  findCatalogEvent,
  findCatalogSignal,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";
import { buildSignalNote } from "../signal-text";
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
  disclaimer = null,
  showPhases = true,
}: {
  estimate: Estimate | null;
  signals: DetectedSignal[];
  evidence: Evidence[];
  catalog: KnowledgeCatalog;
  // 判断が添えた注意書き
  disclaimer?: string | null;
  // よくある流れの欄が段階を示すときは、ここでは段階を出さない
  showPhases?: boolean;
}) {
  const t = useTranslations("judgment.evidence");

  return (
    <Collapsible
      data-testid={testIds.judgment.evidence}
      className="group rounded-2xl bg-foreground/[0.03]"
    >
      <CollapsibleTrigger
        data-testid={testIds.judgment.evidenceToggle}
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-[15px] font-semibold"
      >
        {t("title")}
        <ChevronDown
          className="size-5 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={1.75}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 px-4 pb-4">
        {showPhases && <PhaseTimeline estimate={estimate} catalog={catalog} />}
        <SignalList signals={signals} catalog={catalog} />
        {evidence.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-muted">{t("items")}</h3>
            <ul className="flex flex-col gap-2">
              {evidence.map((item) => {
                const Icon = evidenceIcons[item.kind];
                const href = buildEvidenceHref(item, estimate?.eventType ?? null, catalog);
                return (
                  <li
                    key={`${item.kind}-${item.id}`}
                    data-testid={testIds.judgment.evidenceItem(item.id)}
                  >
                    <EvidenceCard href={href}>
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-muted"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="text-[12px] text-muted">
                          {t(`kinds.${item.kind}`)} ·{" "}
                          <code className="font-mono break-all">{item.id}</code>
                        </p>
                        <p className="text-[14px]">{item.description}</p>
                      </div>
                    </EvidenceCard>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {disclaimer && (
          <p className="flex items-start gap-2 text-[12px] text-muted">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {disclaimer}
          </p>
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
      <h3 className="text-[13px] font-medium text-muted">
        {t("phases")}
        {event && <span className="ml-2">{pickLocalized(event.name, locale)}</span>}
      </h3>
      {estimate?.phaseId == null && <p className="text-[14px] text-muted">{t("unknownPhase")}</p>}
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
                className="relative flex gap-3 pb-3 last:pb-0"
              >
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1 flex size-3 shrink-0 rounded-full border-2",
                      position === "past" && "border-muted bg-muted",
                      position === "current" && "size-4 border-foreground bg-foreground",
                      position === "future" && "border-foreground/20 border-dashed",
                    )}
                  />
                  {i < phases.length - 1 && (
                    <span
                      className={cn(
                        "mt-1 w-0.5 flex-1",
                        position === "past"
                          ? "bg-muted"
                          : "border-l border-dashed border-foreground/20",
                      )}
                    />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p
                    className={cn(
                      "flex flex-wrap items-center gap-2",
                      position === "current"
                        ? "text-[15px] font-semibold"
                        : "text-[14px] text-muted",
                    )}
                  >
                    {pickLocalized(phase.name, locale)}
                    {position === "current" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">
                        <MapPin className="size-3.5" aria-hidden />
                        {t("here")}
                      </span>
                    )}
                  </p>
                  {position === "current" && estimate?.elapsedMinutes != null && (
                    <p className="text-[12px] text-muted">
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
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-muted">{t("signals")}</h3>
      {signals.length === 0 && <p className="text-[14px] text-muted">{t("noSignals")}</p>}
      <ul className="flex flex-col gap-2">
        {signals.map((signal) => {
          const known = findCatalogSignal(catalog, signal.eventType, signal.signalId);
          const note = buildSignalNote(catalog, signal.eventType, signal.signalId, locale);
          return (
            <li
              key={`${signal.eventType}-${signal.signalId}`}
              data-testid={testIds.judgment.signal(signal.signalId)}
            >
              <EvidenceCard
                href={known ? buildSignalHref(signal.signalId) : null}
                testId={testIds.judgment.signalLink(signal.signalId)}
              >
                <Radio
                  className="mt-0.5 size-4 shrink-0 text-muted"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-[14px] font-medium">「{signal.quote}」</p>
                  {note && <p className="text-[13px]">{note}</p>}
                  <code className="font-mono text-[11px] break-all text-muted">
                    {signal.signalId}
                  </code>
                </div>
              </EvidenceCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// 根拠の 1 項目。知見に対応する箇所があれば、知見の閲覧画面へのリンクにする
function EvidenceCard({
  href,
  testId,
  children,
}: {
  href: string | null;
  testId?: string;
  children: ReactNode;
}) {
  const t = useTranslations("judgment.evidence");
  const className = "flex items-start gap-3 rounded-xl bg-surface p-3";
  if (href === null) return <div className={className}>{children}</div>;
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(className, "min-h-11 transition-colors hover:bg-surface-raised")}
    >
      {children}
      <span className="flex shrink-0 items-center gap-0.5 self-center text-muted">
        <span className="sr-only">{t("openKnowledge")}</span>
        <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
    </Link>
  );
}
