"use client";

import type { TrainPosition, TrainType } from "@repo/schema";
import { Check, Pencil, Sparkles, TrainFront, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { inferTrainsAheadDefault } from "@/features/entry/train-position-defaults";
import { pickStationName } from "@/features/stations/describe";
import { cn } from "@/lib/utils";
import { type TrainPositionMeta, useJudgmentSession } from "../session";
import { testIds } from "../testids";

// 駅と駅の間にいる人の前提。次の駅・自分の種別・前の列車を 1 行の小さなチップで並べる
// チップを押すとその場で直せる選択が開き、直すとその前提で判断を出し直す
// 既定値のままのチップは推定と分かる控えめな見た目にし、利用者が直したチップは確定した見た目にする

type ChipKind = "next" | "own" | "ahead";

const trainTypes: TrainType[] = ["local", "rapid", "special_rapid", "limited_express", "unknown"];

const optionChip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-surface px-3 text-[14px] font-semibold shadow-[0_1px_4px_rgb(0_0_0/0.10)] transition-[transform,background-color] duration-150 hover:bg-focus/[0.10] active:scale-[0.96] disabled:opacity-50 aria-pressed:bg-focus/[0.14] aria-pressed:text-focus";

function Chip({
  kind,
  source,
  open,
  disabled,
  label,
  estimatedLabel,
  onClick,
}: {
  kind: ChipKind;
  source: "default" | "user";
  open: boolean;
  disabled: boolean;
  label: string;
  estimatedLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testIds.judgment.trainPositionChip(kind)}
      data-source={source}
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
      className="group -my-1.5 inline-flex h-11 max-w-full min-w-0 items-center disabled:opacity-60"
    >
      <span
        className={cn(
          "inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-full px-2.5 text-[12px] leading-none font-semibold transition-[transform,background-color] duration-150 group-active:scale-[0.97]",
          source === "user"
            ? "bg-focus/[0.12] text-focus group-hover:bg-focus/[0.18]"
            : "border border-dashed border-foreground/30 text-muted group-hover:bg-foreground/[0.05]",
          open && "ring-2 ring-focus",
        )}
      >
        {source === "default" && (
          <>
            <Sparkles className="size-3 shrink-0 opacity-70" strokeWidth={2.25} aria-hidden />
            <span className="sr-only">{estimatedLabel} </span>
          </>
        )}
        <span className="truncate">{label}</span>
        <Pencil className="size-3 shrink-0 opacity-70" strokeWidth={2.25} aria-hidden />
      </span>
    </button>
  );
}

function Editor({
  kind,
  question,
  children,
}: {
  kind: ChipKind;
  question: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testIds.judgment.trainPositionEditor}
      data-kind={kind}
      className="flex animate-step-in flex-col gap-2.5 rounded-2xl bg-foreground/[0.04] p-3"
    >
      <p className="text-[13px] font-semibold">{question}</p>
      {children}
    </div>
  );
}

export function TrainPositionChips({ busy }: { busy: boolean }) {
  const t = useTranslations("judgment.trainPosition");
  const tType = useTranslations("judgment.trainTypes");
  const locale = useLocale();
  const {
    trainPosition,
    trainPositionMeta,
    updateTrainPosition,
    tripContext,
    originLine,
    stationNames,
    rememberStationName,
  } = useJudgmentSession();
  const [open, setOpen] = useState<ChipKind | null>(null);
  // 前の列車の並びの下書き。並びは近い順で、id は消す操作のための通し番号
  const [queue, setQueue] = useState<{ id: number; type: TrainType }[]>([]);
  const nextIdRef = useRef(0);

  if (trainPosition?.kind !== "between_stations" || !trainPosition.nextStation) return null;
  const position = trainPosition;
  const nextStation = trainPosition.nextStation;
  const { edited, trainsAheadFromPattern } = trainPositionMeta;
  const stationLabel = (name: string) =>
    pickStationName({ name, nameEn: stationNames[name] ?? null }, locale);
  const typeName = (type: TrainType) => tType(type);
  const joinTypes = (types: readonly TrainType[]) =>
    types.map(typeName).join(locale === "en" ? ", " : "・");
  const aheadLabel =
    position.trainsAhead === null
      ? t("aheadUnknown")
      : position.trainsAhead.length === 0
        ? t("aheadNone")
        : !edited.trainsAhead && trainsAheadFromPattern
          ? t("aheadPattern", { types: joinTypes(position.trainsAhead) })
          : t("ahead", { types: joinTypes(position.trainsAhead) });
  const candidates = tripContext?.nextStationCandidates ?? [];

  function toggle(kind: ChipKind) {
    if (open === kind) {
      setOpen(null);
      return;
    }
    // 既定の並びは推定なので、下書きは空から始める。利用者が直した並びは、手直しできるよう残す
    if (kind === "ahead") {
      const base = edited.trainsAhead ? (position.trainsAhead ?? []) : [];
      setQueue(base.map((type) => ({ id: nextIdRef.current++, type })));
    }
    setOpen(kind);
  }

  function apply(
    next: TrainPosition,
    changed: Partial<TrainPositionMeta["edited"]>,
    fromPattern = trainsAheadFromPattern,
  ) {
    updateTrainPosition(next, {
      edited: { ...edited, ...changed },
      trainsAheadFromPattern: fromPattern,
    });
    setOpen(null);
  }

  // 次の駅を変える。来た側の駅は、候補の 1 つ前の駅か、入口で選んだ駅
  function chooseNext(index: number) {
    const chosen = candidates[index];
    if (!chosen) return;
    rememberStationName(chosen.name, chosen.nameEn);
    const previous =
      index === 0
        ? (originLine?.stationName ?? position.previousStation)
        : (candidates[index - 1]?.name ?? null);
    apply(
      { ...position, nextStation: chosen.name, previousStation: previous },
      { nextStation: true },
    );
  }

  // 自分の種別を変える。前の列車を直していなければ、新しい種別で既定の並びを引き直す
  function chooseOwn(type: TrainType) {
    if (edited.trainsAhead || !originLine) {
      apply({ ...position, ownTrainType: type }, { ownTrainType: true });
      return;
    }
    const ahead = inferTrainsAheadDefault(
      originLine.lineId,
      tripContext?.directionStopNames ?? [],
      type,
    );
    apply(
      {
        ...position,
        ownTrainType: type,
        trainsAhead: ahead.trainsAhead,
        trainsAheadCount: ahead.trainsAheadCount,
      },
      { ownTrainType: true },
      ahead.fromPattern,
    );
  }

  function applyAhead(list: TrainType[] | null) {
    apply(
      { ...position, trainsAhead: list, trainsAheadCount: list === null ? "unknown" : null },
      { trainsAhead: true },
      false,
    );
  }

  return (
    <div data-testid={testIds.judgment.trainPosition} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0">
        <Chip
          kind="next"
          source={edited.nextStation ? "user" : "default"}
          open={open === "next"}
          disabled={busy || candidates.length === 0}
          label={t("next", { station: stationLabel(nextStation) })}
          estimatedLabel={t("estimated")}
          onClick={() => toggle("next")}
        />
        <Chip
          kind="own"
          source={edited.ownTrainType ? "user" : "default"}
          open={open === "own"}
          disabled={busy}
          label={t("own", { type: typeName(position.ownTrainType ?? "unknown") })}
          estimatedLabel={t("estimated")}
          onClick={() => toggle("own")}
        />
        <Chip
          kind="ahead"
          source={edited.trainsAhead ? "user" : "default"}
          open={open === "ahead"}
          disabled={busy}
          label={aheadLabel}
          estimatedLabel={t("estimated")}
          onClick={() => toggle("ahead")}
        />
      </div>
      {!edited.trainsAhead && open === null && (
        <p data-testid={testIds.judgment.trainPositionHint} className="text-[12px] text-muted">
          {t("patternHint")}
        </p>
      )}
      {open === "next" && (
        <Editor kind="next" question={t("nextQuestion")}>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.name}
                type="button"
                data-testid={testIds.judgment.trainPositionNext(candidate.name)}
                aria-pressed={candidate.name === position.nextStation}
                disabled={busy}
                onClick={() => chooseNext(index)}
                className={optionChip}
              >
                {stationLabel(candidate.name)}
              </button>
            ))}
          </div>
        </Editor>
      )}
      {open === "own" && (
        <Editor kind="own" question={t("ownQuestion")}>
          <div className="flex flex-wrap gap-1.5">
            {trainTypes.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={testIds.judgment.trainPositionType(type)}
                aria-pressed={type === position.ownTrainType}
                disabled={busy}
                onClick={() => chooseOwn(type)}
                className={optionChip}
              >
                {typeName(type)}
              </button>
            ))}
          </div>
        </Editor>
      )}
      {open === "ahead" && (
        <Editor kind="ahead" question={t("aheadQuestion")}>
          {/* 押した列車を小さな電車の札で近い順に並べる。最後の 1 つだけ消せる */}
          <div className="flex min-h-9 flex-wrap items-center gap-1.5" aria-live="polite">
            <span className="text-[11px] font-medium text-muted">{t("aheadQueue")}</span>
            {queue.length === 0 && (
              <span className="text-[12px] text-muted">{t("aheadEmpty")}</span>
            )}
            {queue.map((item) => (
              <span
                key={item.id}
                data-testid={testIds.judgment.trainPositionAheadItem(String(item.id))}
                data-type={item.type}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-surface px-2 text-[12px] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
              >
                <TrainFront className="size-3.5" strokeWidth={2} aria-hidden />
                {item.type === "unknown" ? tType("unknownType") : typeName(item.type)}
              </span>
            ))}
            {queue.length > 0 && (
              <button
                type="button"
                data-testid={testIds.judgment.trainPositionAheadRemove}
                aria-label={t("removeLast")}
                disabled={busy}
                onClick={() => setQueue((prev) => prev.slice(0, -1))}
                className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-foreground/[0.06]"
              >
                <Undo2 className="size-4" strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {trainTypes.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={testIds.judgment.trainPositionAheadAdd(type)}
                disabled={busy}
                onClick={() => setQueue((prev) => [...prev, { id: nextIdRef.current++, type }])}
                className={optionChip}
              >
                <TrainFront className="size-4 text-muted" strokeWidth={2} aria-hidden />
                {type === "unknown" ? tType("unknownType") : typeName(type)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid={testIds.judgment.trainPositionAheadNone}
              disabled={busy}
              onClick={() => applyAhead([])}
              className={cn(optionChip, "bg-foreground/[0.05] shadow-none")}
            >
              {t("aheadNone")}
            </button>
            <button
              type="button"
              data-testid={testIds.judgment.trainPositionAheadUnknown}
              disabled={busy}
              onClick={() => applyAhead(null)}
              className={cn(optionChip, "bg-foreground/[0.05] shadow-none")}
            >
              {tType("unknown")}
            </button>
            <button
              type="button"
              data-testid={testIds.judgment.trainPositionApply}
              disabled={busy || queue.length === 0}
              onClick={() => applyAhead(queue.map((item) => item.type))}
              className={cn(optionChip, "bg-focus text-white hover:bg-focus/90")}
            >
              <Check className="size-4" strokeWidth={2.5} aria-hidden />
              {t("apply")}
            </button>
          </div>
          <p className="text-[11px] text-muted">{t("checkHint")}</p>
        </Editor>
      )}
    </div>
  );
}
