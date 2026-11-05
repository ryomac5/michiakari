"use client";

import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

// 判断の生成中に、閉じたシートへ推論の 5 段を横一列の点で出し、最新の進捗を 1 行添える
// 段の data-testid は始まった段にだけ付け、現れた順を外から確かめられるようにする
export function ReasoningProgress({
  state,
  catalog,
}: {
  state: JudgmentState;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.reasoning");
  const describe = useDescribeStep(state, catalog);
  const started = [...reasoningSteps].reverse().filter((id) => state.steps[id] !== "pending");
  const latest = started[0];
  const progress = latest ? (state.progress[latest] ?? null) : null;
  // 進捗のメモが無ければ、分かったことのうち最も新しいものを添える
  const latestDetail = started.map(describe).find((text) => text !== null) ?? null;

  return (
    <section
      data-testid={testIds.judgment.reasoning}
      aria-live="polite"
      aria-busy={state.status === "streaming"}
      className="flex flex-col gap-3"
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        {state.status === "streaming" && (
          <LoaderCircle className="size-4 animate-spin text-muted" aria-hidden />
        )}
        {t("title")}
      </h2>
      <ol className="grid grid-cols-5 gap-1">
        {reasoningSteps.map((id, i) => (
          <StepDot key={id} id={id} status={state.steps[id]} first={i === 0} />
        ))}
      </ol>
      <p className="min-h-5 truncate text-[13px] text-muted">
        {latest && progress ? (
          <span
            key={progress}
            data-testid={testIds.judgment.reasoningProgress(latest)}
            className="animate-fade-in"
          >
            {progress}
          </span>
        ) : (
          latestDetail
        )}
      </p>
    </section>
  );
}

function StepDot({
  id,
  status,
  first,
}: {
  id: ReasoningStepId;
  status: StepStatus;
  first: boolean;
}) {
  const t = useTranslations("judgment.reasoning");
  const started = status !== "pending";

  return (
    <li
      data-testid={started ? testIds.judgment.reasoningStep(id) : undefined}
      data-state={status}
      className="relative flex flex-col items-center gap-1.5"
    >
      {/* 点どうしをつなぐ線 */}
      {!first && (
        <span
          aria-hidden
          className={cn(
            "absolute top-[7px] right-1/2 left-[-50%] h-0.5 rounded-full transition-colors duration-300",
            started ? "bg-foreground/60" : "bg-foreground/10",
          )}
        />
      )}
      <span
        aria-hidden
        className={cn(
          "relative flex size-4 items-center justify-center rounded-full transition-colors duration-300",
          status === "pending" && "border-2 border-foreground/15 bg-surface",
          status === "active" && "animate-pulse-soft bg-foreground",
          status === "done" && "bg-foreground text-background",
          status === "failed" && "bg-danger text-background",
        )}
      >
        {status === "done" && <Check className="size-2.5" strokeWidth={3.5} />}
        {status === "failed" && <CircleAlert className="size-2.5" strokeWidth={3} />}
      </span>
      <span
        className={cn(
          "text-center text-[11px] leading-tight",
          started ? "text-foreground" : "text-muted",
          status === "active" && "font-semibold",
        )}
      >
        {t(`short.${id}`)}
        <span className="sr-only">（{t(`status.${status}`)}）</span>
      </span>
    </li>
  );
}

// 判断が出たあとに、推論の過程を振り返る。終わった過程は畳み、見たい人だけが開く
export function ReasoningLog({
  state,
  catalog,
}: {
  state: JudgmentState;
  catalog: KnowledgeCatalog;
}) {
  const t = useTranslations("judgment.reasoning");
  const describe = useDescribeStep(state, catalog);
  const steps = reasoningSteps.filter((id) => state.steps[id] !== "pending");
  if (steps.length === 0) return null;

  return (
    <Collapsible
      data-testid={testIds.judgment.reasoningLog}
      className="group rounded-2xl bg-foreground/[0.03]"
    >
      <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-left text-[15px] font-semibold">
        {t("logTitle")}
        <ChevronDown
          className="size-5 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
          strokeWidth={1.75}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="flex flex-col px-4 pb-2">
          {steps.map((id, i) => (
            <li key={id} data-state={state.steps[id]} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full text-background",
                    state.steps[id] === "failed" ? "bg-danger" : "bg-foreground",
                  )}
                >
                  <Check className="size-2.5" strokeWidth={3.5} aria-hidden />
                </span>
                {i < steps.length - 1 && <span className="w-px flex-1 bg-foreground/15" />}
              </span>
              <div className="flex min-w-0 flex-col pb-3">
                <p className="text-[14px] font-medium">{t(`steps.${id}`)}</p>
                <p className="text-[13px] text-muted">{describe(id)}</p>
                {state.progress[id] && (
                  <p className="text-[12px] leading-snug text-muted">{state.progress[id]}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 段の中身を短い文にする。まだ分からなければ null
function useDescribeStep(state: JudgmentState, catalog: KnowledgeCatalog) {
  const t = useTranslations("judgment.reasoning.detail");
  const locale = useLocale();

  return (id: ReasoningStepId): string | null => {
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
  };
}
