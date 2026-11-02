"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  findCatalogEvent,
  type KnowledgeCatalog,
  pickLocalized,
} from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";
import {
  type JudgmentState,
  type ReasoningStepId,
  reasoningSteps,
  type StepStatus,
} from "../state";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 判断の生成中に、結論カードの位置へ推論の過程を順に表示する
export function ReasoningProgress({
  state,
  catalog,
}: {
  state: JudgmentState;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.reasoning");
  const visible = reasoningSteps.filter((id) => state.steps[id] !== "pending");

  return (
    <section
      data-testid={testIds.judgment.reasoning}
      aria-live="polite"
      aria-busy={state.status === "streaming"}
      className="flex min-h-[33dvh] flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        {state.status === "streaming" && (
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
        )}
        {t("title")}
      </h2>
      <ol className="flex flex-col gap-3">
        {visible.map((id) => (
          <ReasoningStep
            key={id}
            id={id}
            status={state.steps[id]}
            detail={<StepDetail id={id} state={state} catalog={catalog} />}
          />
        ))}
      </ol>
    </section>
  );
}

const statusIcons: Record<Exclude<StepStatus, "pending">, typeof CircleCheck> = {
  active: LoaderCircle,
  done: CircleCheck,
  failed: CircleAlert,
};

function ReasoningStep({
  id,
  status,
  detail,
}: {
  id: ReasoningStepId;
  status: StepStatus;
  detail: ReactNode;
}) {
  const t = useTranslations("judgment.reasoning");
  if (status === "pending") return null;
  const Icon = statusIcons[status];

  return (
    <li
      data-testid={testIds.judgment.reasoningStep(id)}
      data-state={status}
      className="flex animate-step-in items-start gap-3"
    >
      <Icon
        className={cn(
          "mt-0.5 size-6 shrink-0",
          status === "active" && "animate-spin text-focus",
          status === "done" && "text-foreground",
          status === "failed" && "text-danger",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col">
        <p className={cn("text-lg font-bold", status === "active" && "animate-pulse-soft")}>
          {t(`steps.${id}`)}
          <span className="sr-only">（{t(`status.${status}`)}）</span>
        </p>
        <p className="truncate text-muted">{detail}</p>
      </div>
    </li>
  );
}

function StepDetail({
  id,
  state,
  catalog,
}: {
  id: ReasoningStepId;
  state: JudgmentState;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.reasoning.detail");
  const locale = useLocale();

  switch (id) {
    case "reading": {
      const text = state.observations.at(-1)?.rawText;
      return text ? t("reading", { text }) : null;
    }
    case "signals":
      return state.signals.length > 0 ? t("signals", { count: state.signals.length }) : null;
    case "phase": {
      const estimate = state.estimate;
      if (!estimate?.phaseId) return null;
      const phase = findCatalogEvent(catalog, estimate.eventType)?.phases.find(
        (p) => p.id === estimate.phaseId,
      );
      return t("phase", { phase: phase ? pickLocalized(phase.name, locale) : estimate.phaseId });
    }
    case "options":
      return state.options ? t("options", { count: state.options.length }) : null;
    case "breakEven":
      if (!state.breakEvenComputed) return null;
      return state.breakEven
        ? t("breakEven", { time: formatClockTime(state.breakEven.time, locale) })
        : t("breakEvenNone");
  }
}
