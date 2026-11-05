"use client";

import { classifyFlowOutlook } from "@repo/core";
import type { Estimate, TypicalFlow } from "@repo/schema";
import { MapPin, Route } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { pickLocalized } from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";

// 事象のよくある流れ。段階を横に並べた細い帯に、いまの段階の印と目安の分を添える
// 半分開いた状態では 1 行の要約だけを出し、全部開くと帯と見込みの立てやすさを出す
// 知見の根拠の文は開発者向けなので出さない。代わりに「ふつう1時間ほどで再開」を分数から組み立てる

export type FlowTestIds = {
  section: string;
  phase: (id: string) => string;
};

type Position = "past" | "current" | "future";

type Translate = ReturnType<typeof useTranslations<"judgment.flow">>;

function formatDuration(t: Translate, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("duration.minutes", { minutes });
  if (rest === 0) return t("duration.hours", { hours });
  return t("duration.hoursMinutes", { hours, minutes: rest });
}

// 「ふつう1時間ほどで再開」。短く終わる事象は「ふつう5〜10分で終わる」。数値は知見から core が求めた値を使う
export function buildUsualText(t: Translate, flow: TypicalFlow): string {
  const { p50, p80 } = flow.untilResume;
  if (classifyFlowOutlook(flow) === "short") {
    return t("usual.short", { span: p50 === p80 ? `${p80}` : `${p50}〜${p80}` });
  }
  return t("usual.long", { duration: formatDuration(t, flow.typicalFloorMinutes ?? p50) });
}

// 帯の各段の幅は p50 に比べる。短い段も名前が読めるよう最小の幅を持たせる
function selectGrow(p50: number): number {
  return Math.max(1, p50);
}

export function TypicalFlowSection({
  flow,
  estimate,
  expanded,
  testIds,
}: {
  flow: TypicalFlow;
  estimate: Estimate | null;
  // 帯と根拠を出すか。シートを全部開いたときと PC 幅で true
  expanded: boolean;
  testIds: FlowTestIds;
}) {
  const t = useTranslations("judgment.flow");
  const locale = useLocale();
  const currentId = estimate?.eventType === flow.eventType ? estimate.phaseId : null;
  const currentIndex = flow.phases.findIndex((p) => p.id === currentId);
  const current = flow.phases[currentIndex];
  const level = flow.predictability.level;

  return (
    <section
      data-testid={testIds.section}
      data-event-type={flow.eventType}
      data-phase-id={currentId ?? ""}
      data-predictability={level}
      data-expanded={expanded}
      aria-labelledby="typical-flow-title"
      className="flex flex-col gap-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2
          id="typical-flow-title"
          className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted"
        >
          <Route className="size-4" strokeWidth={1.75} aria-hidden />
          {t("title")}
        </h2>
        <p className="min-w-0 truncate text-[14px] font-semibold">
          {current
            ? t("now", {
                index: currentIndex + 1,
                total: flow.phases.length,
                phase: pickLocalized(current.name, locale),
              })
            : t("steps", { total: flow.phases.length })}
        </p>
      </div>

      <div className={cn("flex flex-col gap-3", !expanded && "hidden")}>
        <ol className="flex gap-1">
          {flow.phases.map((phase, i) => {
            const position: Position =
              currentIndex < 0
                ? "future"
                : i < currentIndex
                  ? "past"
                  : i === currentIndex
                    ? "current"
                    : "future";
            return (
              <li
                key={phase.id}
                data-testid={testIds.phase(phase.id)}
                data-position={position}
                aria-current={position === "current" ? "step" : undefined}
                style={{ flexGrow: selectGrow(phase.duration.p50), flexBasis: 0 }}
                className="flex min-w-[64px] flex-col gap-1.5"
              >
                <span
                  className={cn(
                    "h-1.5 rounded-full transition-colors duration-300",
                    position === "past" && "bg-foreground/35",
                    position === "current" && "bg-foreground",
                    position === "future" && "bg-foreground/10",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] leading-tight break-words",
                    position === "current" ? "font-semibold" : "text-muted",
                  )}
                >
                  {pickLocalized(phase.name, locale)}
                </span>
                <span className="text-[11px] text-muted tabular-nums">
                  {t("minutes", { minutes: phase.duration.p50 })}
                </span>
                {position === "current" && (
                  <span className="inline-flex w-fit animate-step-in items-center gap-0.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                    <MapPin className="size-3" aria-hidden />
                    {t("here")}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p data-testid={`${testIds.section}-basis`} className="text-[13px] leading-relaxed">
          <span
            data-level={level}
            className={cn(
              "mr-2 inline-flex rounded-full px-2 py-0.5 align-[1px] text-[11px] font-semibold",
              level === "high" ? "bg-wait-surface text-wait" : "bg-foreground/[0.06] text-muted",
            )}
          >
            {t(`predictability.${level}`)}
          </span>
          {buildUsualText(t, flow)}
        </p>
      </div>
    </section>
  );
}
