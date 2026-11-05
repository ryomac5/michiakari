"use client";

import type { RawInput } from "@repo/schema";
import {
  ArrowUp,
  BellRing,
  Camera,
  ChevronRight,
  ClipboardPaste,
  Clock,
  CloudRain,
  HelpCircle,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  MapPin,
  Pencil,
  Siren,
  Timer,
  TrainFront,
  TrainTrack,
  Wrench,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import type { OriginLine } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import {
  type KnowledgeCatalog,
  pickLocalized as pickCatalogName,
} from "@/features/knowledge/catalog";
import {
  type CauseId,
  type CauseOption,
  type ElapsedOption,
  elapsedOptions,
  type ResumeOptionId,
  type ResumeTimeOption,
} from "@/features/situation/plain-questions";
import { PastePanel, PhotoPanel } from "@/features/situation/SituationInput";
import type { StationChoice } from "@/features/stations/catalog";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { pickStationName } from "@/features/stations/describe";
import { cn } from "@/lib/utils";
import type { DirectionStop, EntryDirection } from "./directions";
import { SheetTitle } from "./EntrySheet";
import type { EntryArea, EntryLine, EntryPlace } from "./entry-places";
import { pickLocalized, pickPlaceName } from "./entry-places";
import { type EntryMethod, progressSteps } from "./flow";

// 入口のシートの中身。段ごとに 1 つの問いだけを出し、答えはチップを 1 回押せば進む

const chipBase =
  "inline-flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 text-left text-[15px] leading-tight font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97] disabled:opacity-60";
const softChip = "bg-foreground/[0.05] hover:bg-foreground/[0.09]";
// 大きな選択肢の札。2 つを横に並べる
const cardBase =
  "flex min-h-[76px] items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-[transform,background-color] duration-150 active:scale-[0.97]";

// 路線色を淡く敷いたチップ。左の太い印で路線色を示す
function LineButton({
  line,
  testId,
  onClick,
}: {
  line: EntryLine;
  testId: string;
  onClick: () => void;
}) {
  const locale = useLocale();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={`${pickLocalized(line.name, locale)} ${pickLocalized(line.operator, locale)}`}
      style={{ backgroundColor: `${line.color}1f` }}
      className={cn(chipBase, "py-2 hover:brightness-95 dark:hover:brightness-125")}
    >
      <span
        aria-hidden
        className="h-6 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: line.color }}
      />
      {pickLocalized(line.name, locale)}
    </button>
  );
}

export function LineTag({ line, suspended }: { line: OriginLine; suspended?: string }) {
  const locale = useLocale();
  return (
    <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] pr-2.5 pl-2 text-[13px] leading-none font-semibold">
      <span
        aria-hidden
        className="h-3.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: line.color }}
      />
      <span className="truncate">{pickLocalized(line.name, locale)}</span>
      {suspended && <span className="shrink-0 text-danger">{suspended}</span>}
    </span>
  );
}

// 進み具合の印。路線から様子までの 5 つの点で、いまの段を横長の点にする
export function EntryProgress({ index }: { index: number }) {
  const t = useTranslations("entry");
  const step = progressSteps[index];
  if (!step) return null;
  return (
    <div
      data-testid={testIds.start.progress}
      data-step={index}
      className="flex items-center gap-2 text-[12px] font-semibold text-muted"
    >
      <span className="sr-only">
        {t("progress", {
          current: index + 1,
          total: progressSteps.length,
          step: t(`steps.${step}`),
        })}
      </span>
      <span aria-hidden>{t(`steps.${step}`)}</span>
      <span aria-hidden className="flex items-center gap-1">
        {progressSteps.map((s, i) => (
          <span
            key={s}
            className={cn(
              "h-1.5 rounded-full transition-[width,background-color] duration-200",
              i === index ? "w-4 bg-focus" : "w-1.5",
              i < index && "bg-focus/50",
              i > index && "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </div>
  );
}

// 「心斎橋・地下鉄御堂筋線」。各段の問いの上に、ここまでの答えを 1 行で添える
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold">
      {children}
    </div>
  );
}

function HereName({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-focus">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-focus" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function AreaStep({
  area,
  onSelect,
}: {
  area: EntryArea;
  onSelect: (place: EntryPlace) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const first = area.places[0];
  const name = area.name
    ? pickLocalized(area.name, locale)
    : t("around", { station: first ? pickPlaceName(first, locale) : "" });
  return (
    <>
      <SheetTitle title={t("areaQuestion")} hint={t("areaHint", { area: name })} />
      <div className="flex flex-wrap gap-2">
        {area.places.map((place) => (
          <button
            key={place.key}
            type="button"
            data-testid={testIds.start.areaPlace(place.key)}
            onClick={() => onSelect(place)}
            className={cn(chipBase, softChip)}
          >
            {pickPlaceName(place, locale)}
            <span aria-hidden className="flex gap-0.5">
              {[...new Set(place.lines.map((l) => l.color))].slice(0, 4).map((color) => (
                <span
                  key={color}
                  className="h-3 w-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function StationStep({
  place,
  note,
  onSelect,
}: {
  place: EntryPlace;
  note: string | null;
  onSelect: (line: EntryLine) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  return (
    <>
      <SheetTitle
        eyebrow={
          <Eyebrow>
            <HereName name={pickPlaceName(place, locale)} />
          </Eyebrow>
        }
        title={t("lineQuestion")}
        hint={note ?? t("lineHint")}
      />
      <div className="flex flex-wrap gap-2">
        {place.lines.map((line) => (
          <LineButton
            key={line.key}
            line={line}
            testId={testIds.start.line(line.key)}
            onClick={() => onSelect(line)}
          />
        ))}
      </div>
    </>
  );
}

// 方面の名前。「新大阪・千里中央方面」
export function useDirectionName() {
  const t = useTranslations("entry");
  const locale = useLocale();
  return (direction: Pick<EntryDirection, "label">) =>
    t("directionName", { names: pickLocalized(direction.label, locale) });
}

// 選んだ駅から方面の 3 駅先へ向かう向き。地図の上が北なので、矢印をその向きに回す
export function computeDirectionAngle(from: [number, number], direction: EntryDirection): number {
  const target = direction.stops[Math.min(2, direction.stops.length - 1)];
  if (!target) return 0;
  const dx = (target.position[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dy = target.position[1] - from[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function DirectionStep({
  originName,
  line,
  directions,
  angles,
  onSelect,
}: {
  originName: string;
  line: OriginLine;
  directions: EntryDirection[];
  angles: Record<string, number>;
  onSelect: (direction: EntryDirection) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const nameDirection = useDirectionName();
  return (
    <>
      <SheetTitle
        eyebrow={
          <Eyebrow>
            <HereName name={originName} />
            <LineTag line={line} />
          </Eyebrow>
        }
        title={t("directionQuestion")}
        hint={t("directionHint")}
      />
      <div className="grid grid-cols-2 gap-2">
        {directions.map((direction) => {
          const next = direction.stops[0];
          return (
            <button
              key={direction.key}
              type="button"
              data-testid={testIds.start.direction(direction.key)}
              onClick={() => onSelect(direction)}
              className={cn(cardBase, "flex-col items-start gap-2", softChip)}
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-white shadow-[0_1px_4px_rgb(0_0_0/0.2)]"
                style={{ backgroundColor: line.color }}
              >
                <ArrowUp
                  className="size-[18px]"
                  strokeWidth={2.75}
                  style={{ transform: `rotate(${angles[direction.key] ?? 0}deg)` }}
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[16px] leading-snug font-bold text-balance">
                  {nameDirection(direction)}
                </span>
                {next && (
                  <span className="text-[12px] leading-tight text-muted">
                    {t("nextStation", { station: pickStationName(next.choice, locale) })}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function StopChip({
  stop,
  testId,
  onClick,
  icon,
}: {
  stop: DirectionStop;
  testId: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  const locale = useLocale();
  return (
    <button
      type="button"
      data-testid={testId}
      data-operator={stop.choice.operators[0]?.name ?? ""}
      onClick={onClick}
      className={cn(chipBase, softChip)}
    >
      {icon ?? <MapPin className="size-4 text-muted" strokeWidth={2} aria-hidden />}
      {pickStationName(stop.choice, locale)}
    </button>
  );
}

export function DestinationStep({
  originName,
  line,
  direction,
  candidates,
  onSelect,
  onUndecided,
  onFreeText,
}: {
  originName: string;
  line: OriginLine;
  direction: EntryDirection;
  candidates: DirectionStop[];
  onSelect: (station: StationChoice) => void;
  onUndecided: () => void;
  onFreeText: (text: string) => void;
}) {
  const t = useTranslations("entry");
  const nameDirection = useDirectionName();
  const locale = useLocale();
  return (
    <>
      <SheetTitle
        eyebrow={
          <Eyebrow>
            <HereName name={originName} />
            <LineTag line={line} />
          </Eyebrow>
        }
        title={t("destinationQuestion")}
        hint={t("destinationHint", { direction: pickLocalized(direction.label, locale) })}
      />
      <div className="flex flex-wrap gap-2">
        {candidates.map((stop) => (
          <StopChip
            key={stop.choice.id}
            stop={stop}
            testId={testIds.start.destinationCandidate(stop.choice.id)}
            onClick={() => onSelect(stop.choice)}
          />
        ))}
        <button
          type="button"
          data-testid={testIds.start.destinationUndecided}
          onClick={onUndecided}
          aria-label={`${t("destinationUndecided")}・${nameDirection(direction)}`}
          className={cn(
            chipBase,
            "border-[1.5px] border-dashed border-foreground/25 hover:bg-foreground/[0.05]",
          )}
        >
          <HelpCircle className="size-4 text-muted" strokeWidth={2} aria-hidden />
          <span className="flex flex-col">
            {t("destinationUndecided")}
            <span className="text-[11px] font-medium text-muted">
              {t("destinationUndecidedNote")}
            </span>
          </span>
        </button>
      </div>
      <StationSearch
        hideLabel
        label={t("destinationLabel")}
        placeholder={t("destinationSearchLabel")}
        onSelect={onSelect}
        onFreeText={onFreeText}
        testIds={{
          search: testIds.start.destinationSearch,
          option: testIds.start.destinationOption,
        }}
      />
    </>
  );
}

// いまどこにいるか。駅にいる、駅に止まっている車内、駅と駅の間の 3 つを聞く
// 駅に止まっている車内なら、止まっている駅を道順に並べて聞く。駅と駅の間は既定値で先へ進む
export function PositionStep({
  originName,
  line,
  onTrain,
  nearby,
  hereId,
  onStation,
  onTrainChosen,
  onBetween,
  onNearStop,
}: {
  originName: string;
  line: OriginLine;
  onTrain: boolean;
  nearby: DirectionStop[];
  hereId: string;
  onStation: () => void;
  onTrainChosen: () => void;
  onBetween: () => void;
  onNearStop: (stop: DirectionStop) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  if (!onTrain) {
    return (
      <>
        <SheetTitle
          eyebrow={
            <Eyebrow>
              <HereName name={originName} />
              <LineTag line={line} />
            </Eyebrow>
          }
          title={t("positionQuestion")}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid={testIds.start.positionStation}
            onClick={onStation}
            className={cn(cardBase, softChip, "col-span-2 min-h-[64px]")}
          >
            <MapPin className="size-6 shrink-0 text-focus" strokeWidth={2} aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] leading-snug font-bold">
                {t("positionStation", { station: originName })}
              </span>
              <span className="text-[12px] text-muted">{t("positionStationNote")}</span>
            </span>
          </button>
          <button
            type="button"
            data-testid={testIds.start.positionTrain}
            onClick={onTrainChosen}
            className={cn(cardBase, "flex-col items-start gap-2", softChip)}
          >
            <TrainFront className="size-6 shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] leading-snug font-bold text-balance">
                {t("positionTrain")}
              </span>
              <span className="text-[12px] text-muted">{t("positionTrainNote")}</span>
            </span>
          </button>
          <button
            type="button"
            data-testid={testIds.start.positionBetween}
            onClick={onBetween}
            className={cn(cardBase, "flex-col items-start gap-2", softChip)}
          >
            <TrainTrack className="size-6 shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] leading-snug font-bold text-balance">
                {t("positionBetween")}
              </span>
              <span className="text-[12px] text-muted">{t("positionBetweenNote")}</span>
            </span>
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <SheetTitle
        eyebrow={
          <Eyebrow>
            <span className="flex items-center gap-1.5">
              <TrainFront className="size-4" strokeWidth={2} aria-hidden />
              {t("positionTrain")}
            </span>
            <LineTag line={line} />
          </Eyebrow>
        }
        title={t("positionNearQuestion")}
        hint={t("positionNearHint")}
      />
      {/* 駅を道順に並べ、路線色の線でつなぐ。右が進む向き */}
      <div className="relative grid grid-flow-col auto-cols-fr gap-2">
        <span
          aria-hidden
          className="absolute top-1/2 right-6 left-6 h-1 -translate-y-1/2 rounded-full opacity-60"
          style={{ backgroundColor: line.color }}
        />
        {nearby.map((stop) => (
          <button
            key={stop.choice.id}
            type="button"
            data-testid={testIds.start.nearStop(stop.choice.id)}
            onClick={() => onNearStop(stop)}
            className={cn(
              "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl bg-surface px-2 py-2 text-center text-[14px] leading-tight font-bold ring-1 ring-[var(--glass-border)] shadow-[0_1px_6px_rgb(0_0_0/0.10)] transition-transform duration-150 active:scale-[0.96]",
              stop.choice.id === hereId && "ring-2 ring-focus",
            )}
          >
            <span
              aria-hidden
              className="size-3 rounded-full border-[3px] bg-surface"
              style={{ borderColor: line.color }}
            />
            {pickStationName(stop.choice, locale)}
          </button>
        ))}
      </div>
    </>
  );
}

// 行き先と出発の札。様子の最初の問いの上で、ここまでの答えをまとめて見せる
export function TripCard({
  originName,
  originNote,
  destinationName,
  destinationNote,
  line,
  onEditLine,
  onEditDestination,
}: {
  originName: string;
  originNote: string | null;
  destinationName: string;
  destinationNote: string | null;
  line: OriginLine;
  onEditLine: () => void;
  onEditDestination: () => void;
}) {
  const t = useTranslations("entry");
  return (
    <div
      data-testid={testIds.start.trip}
      className="relative flex flex-col rounded-2xl bg-foreground/[0.04] px-1"
    >
      {/* 出発と行き先を縦の点線で結ぶ */}
      <span
        aria-hidden
        className="absolute top-[26px] bottom-[26px] left-[21px] border-l-2 border-dotted border-foreground/25"
      />
      <button
        type="button"
        data-testid={testIds.start.editLine}
        onClick={onEditLine}
        aria-label={`${t("from")} ${originName}・${t("change")}`}
        className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-foreground/[0.04]"
      >
        <span className="relative size-3.5 shrink-0 rounded-full border-[3px] border-white bg-focus shadow-[0_1px_4px_rgb(0_0_0/0.3)]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] font-bold">{originName}</span>
          {originNote && <span className="truncate text-[12px] text-muted">{originNote}</span>}
        </span>
        <LineTag line={line} suspended={t("suspended")} />
      </button>
      <button
        type="button"
        data-testid={testIds.start.editDestination}
        onClick={onEditDestination}
        aria-label={`${t("to")} ${destinationName}・${t("change")}`}
        className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-foreground/[0.04]"
      >
        <MapPin
          className="relative size-4 shrink-0 -translate-x-px fill-foreground text-foreground"
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] font-bold">{destinationName}</span>
          {destinationNote && (
            <span className="truncate text-[12px] text-muted">{destinationNote}</span>
          )}
        </span>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </button>
    </div>
  );
}

// 「心斎橋 → 新大阪」。2 問目からは、ここまでの答えを 1 行に縮めて添える。押すと行き先を選び直せる
export function TripLine({
  originName,
  destinationName,
  line,
  onEditDestination,
}: {
  originName: string;
  destinationName: string;
  line: OriginLine;
  onEditDestination: () => void;
}) {
  const t = useTranslations("entry");
  return (
    <button
      type="button"
      data-testid={testIds.start.editDestination}
      onClick={onEditDestination}
      aria-label={`${originName} → ${destinationName}・${t("change")}`}
      className="-mx-2 flex min-h-11 w-fit max-w-full items-center rounded-xl px-2 text-left hover:bg-foreground/[0.04]"
    >
      <Eyebrow>
        <span className="flex min-w-0 items-center gap-1.5">
          <HereName name={originName} />
          <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />
          <span className="truncate">{destinationName}</span>
        </span>
        <LineTag line={line} />
      </Eyebrow>
    </button>
  );
}

// 発表文や掲示を持っている人向けの、撮る・貼るの控えめな入口
function MethodLinks({ onSelect }: { onSelect: (method: EntryMethod) => void }) {
  const t = useTranslations("entry");
  const link = (method: EntryMethod, icon: ReactNode) => (
    <button
      type="button"
      data-testid={testIds.start.method(method)}
      onClick={() => onSelect(method)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-foreground transition-colors hover:bg-foreground/[0.06] active:scale-[0.97]"
    >
      {icon}
      {t(`methods.${method}.title`)}
    </button>
  );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 border-t border-foreground/10 pt-3 text-[13px] text-muted">
      <span className="py-2.5 pr-1 font-medium">{t("withText")}</span>
      {link("photo", <Camera className="size-4" strokeWidth={2} aria-hidden />)}
      {link("paste", <ClipboardPaste className="size-4" strokeWidth={2} aria-hidden />)}
    </div>
  );
}

export function InputStep({
  method,
  trip,
  busy,
  onSubmit,
}: {
  method: EntryMethod;
  trip: ReactNode;
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle eyebrow={trip} title={t(`methods.${method}.heading`)} />
      {method === "photo" && <PhotoPanel busy={busy} onSubmit={onSubmit} />}
      {method === "paste" && <PastePanel busy={busy} onSubmit={onSubmit} />}
    </>
  );
}

// 答えたことを示すチップ。押すとその問いへ戻って選び直せる
export type AnsweredItem = { kind: "cause" | "elapsed"; label: string; onEdit: () => void };

function AnswerChips({ items }: { items: AnsweredItem[] }) {
  const t = useTranslations("entry");
  if (items.length === 0) return null;
  // 横に並べ、収まらなければ折り返す。押せる高さは 44px のまま、見える札は低くして場所を取らない
  return (
    <div className="flex flex-wrap gap-x-1.5">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          data-testid={testIds.start.answer(item.kind)}
          onClick={item.onEdit}
          aria-label={`${t(`answers.${item.kind}`)} ${item.label}・${t("change")}`}
          className="group -my-1.5 inline-flex h-11 max-w-full min-w-0 items-center"
        >
          <span className="inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-full bg-focus/[0.10] px-2.5 text-[12px] leading-none font-semibold text-focus transition-[transform,background-color] duration-150 group-hover:bg-focus/[0.16] group-active:scale-[0.97]">
            <span className="truncate">{item.label}</span>
            <Pencil className="size-3 shrink-0 opacity-70" strokeWidth={2.25} aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}

// 問いの上に、行き先の 1 行とここまでの答えのチップを重ねる
function QuestionEyebrow({ trip, answers }: { trip: ReactNode; answers: AnsweredItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {trip}
      <AnswerChips items={answers} />
    </div>
  );
}

const causeIcons: Record<CauseId, LucideIcon> = {
  person: Siren,
  inCar: BellRing,
  vehicle: Wrench,
  signal: Zap,
  rain: CloudRain,
};

// 原因や答えの大きな札。左に丸い印、右に言葉
function AnswerCard({
  testId,
  icon,
  label,
  tone = "soft",
  span = false,
  disabled = false,
  pending = false,
  onClick,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  tone?: "soft" | "dashed";
  span?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        cardBase,
        "min-h-[68px] disabled:opacity-60",
        tone === "soft"
          ? softChip
          : "border-[1.5px] border-dashed border-foreground/25 hover:bg-foreground/[0.05]",
        span && "col-span-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          tone === "soft"
            ? "bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.12)]"
            : "bg-foreground/[0.05] text-muted",
        )}
      >
        {pending ? <LoaderCircle className="size-5 animate-spin" /> : icon}
      </span>
      <span className="text-[15px] leading-snug font-bold text-balance">{label}</span>
    </button>
  );
}

// 1 問目。放送で何と言っていたか。知見にある原因と、聞き取れなかったを同じ重さで並べる
export function CauseStep({
  options,
  catalog,
  onSelect,
  onMethod,
}: {
  options: CauseOption[];
  catalog: KnowledgeCatalog;
  onSelect: (eventType: string | null) => void;
  onMethod: (method: EntryMethod) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const nameOption = (option: CauseOption) => {
    if (option.kind === "preset") return t(`causes.${option.id}`);
    const event = catalog.find((e) => e.id === option.eventType);
    return event ? pickCatalogName(event.name, locale) : option.eventType;
  };
  const iconOf = (option: CauseOption) => {
    const Icon = option.kind === "preset" ? causeIcons[option.id] : TrainFront;
    return <Icon className="size-5" strokeWidth={1.75} />;
  };
  return (
    <>
      <SheetTitle title={t("causeQuestion")} />
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <AnswerCard
            key={option.eventType}
            testId={testIds.start.cause(option.id)}
            icon={iconOf(option)}
            label={nameOption(option)}
            onClick={() => onSelect(option.eventType)}
          />
        ))}
        <AnswerCard
          testId={testIds.start.cause("unknown")}
          icon={<HelpCircle className="size-5" strokeWidth={1.75} />}
          label={t("causes.unknown")}
          tone="dashed"
          span={options.length % 2 === 0}
          onClick={() => onSelect(null)}
        />
      </div>
      <MethodLinks onSelect={onMethod} />
    </>
  );
}

// 2 問目。止まってどれくらいか
export function ElapsedStep({
  trip,
  answers,
  onSelect,
}: {
  trip: ReactNode;
  answers: AnsweredItem[];
  onSelect: (option: ElapsedOption) => void;
}) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle
        eyebrow={<QuestionEyebrow trip={trip} answers={answers} />}
        title={t("elapsedQuestion")}
      />
      <div className="grid grid-cols-2 gap-2">
        {elapsedOptions.map((option) => (
          <AnswerCard
            key={option.id}
            testId={testIds.start.elapsed(option.id)}
            icon={
              option.minutes === null ? (
                <HelpCircle className="size-5" strokeWidth={1.75} />
              ) : (
                <Timer className="size-5" strokeWidth={1.75} />
              )
            }
            label={t(`elapsed.${option.id}`)}
            tone={option.minutes === null ? "dashed" : "soft"}
            onClick={() => onSelect(option)}
          />
        ))}
      </div>
    </>
  );
}

// 再開見込みの答え。時刻を言っていたときだけ time を持つ
export type ResumeAnswer = { id: ResumeOptionId; time: ResumeTimeOption | null };

// 3 問目。再開の見込みを言っていたか。時刻を言っていたなら、その場で時刻を選ぶ
// どの答えも押せばそのまま判断を始める
export function ResumeStep({
  trip,
  answers,
  busy,
  pending,
  times,
  onSelect,
}: {
  trip: ReactNode;
  answers: AnsweredItem[];
  busy: boolean;
  // 押した答えの id。時刻なら HHMM
  pending: string | null;
  times: ResumeTimeOption[];
  onSelect: (answer: ResumeAnswer) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const [statedOpen, setStatedOpen] = useState(false);
  return (
    <>
      <SheetTitle
        eyebrow={<QuestionEyebrow trip={trip} answers={answers} />}
        title={t("resumeQuestion")}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid={testIds.start.resume("stated")}
          aria-expanded={statedOpen}
          disabled={busy}
          onClick={() => setStatedOpen((v) => !v)}
          className={cn(
            cardBase,
            "col-span-2 min-h-[68px] disabled:opacity-60",
            statedOpen ? "bg-focus/[0.10] ring-2 ring-focus" : softChip,
          )}
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.12)]"
          >
            <Clock className="size-5" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] leading-snug font-bold">{t("resume.stated")}</span>
            <span className="text-[12px] leading-tight text-muted">{t("resume.statedNote")}</span>
          </span>
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted transition-transform duration-200",
              statedOpen && "rotate-90",
            )}
            aria-hidden
          />
        </button>
        {statedOpen && (
          <div className="col-span-2 flex animate-step-in flex-col gap-2 rounded-2xl bg-foreground/[0.04] p-3">
            <p className="text-[13px] font-semibold text-muted">{t("resumeTimeQuestion")}</p>
            <div className="grid grid-cols-4 gap-2">
              {times.map((time) => (
                <button
                  key={time.id}
                  type="button"
                  data-testid={testIds.start.resumeTime(time.id)}
                  disabled={busy}
                  onClick={() => onSelect({ id: "stated", time })}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-surface text-[15px] font-bold tabular-nums shadow-[0_1px_4px_rgb(0_0_0/0.10)] transition-[transform,background-color] duration-150 hover:bg-focus/[0.10] active:scale-[0.96] disabled:opacity-60"
                >
                  {pending === time.id && (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  )}
                  {formatClockTime(time.iso, locale)}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* 言葉が長いので、3 つとも横いっぱいの札にして同じ重さで並べる */}
        <AnswerCard
          testId={testIds.start.resume("undecided")}
          icon={<Hourglass className="size-5" strokeWidth={1.75} />}
          label={t("resume.undecided")}
          span
          disabled={busy}
          pending={pending === "undecided"}
          onClick={() => onSelect({ id: "undecided", time: null })}
        />
        <AnswerCard
          testId={testIds.start.resume("unknown")}
          icon={<HelpCircle className="size-5" strokeWidth={1.75} />}
          label={t("resume.unknown")}
          tone="dashed"
          span
          disabled={busy}
          pending={pending === "unknown"}
          onClick={() => onSelect({ id: "unknown", time: null })}
        />
      </div>
    </>
  );
}
