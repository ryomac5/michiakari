"use client";

import type { RawInput } from "@repo/schema";
import { Camera, ChevronRight, ClipboardPaste, ListChecks, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { OriginLine } from "@/features/judgment/session";
import { type SituationTab, testIds } from "@/features/judgment/testids";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { PastePanel, PhotoPanel, SelectPanel } from "@/features/situation/SituationInput";
import type { StationChoice } from "@/features/stations/catalog";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { cn } from "@/lib/utils";
import { SheetTitle } from "./EntrySheet";
import type { EntryArea, EntryHub, EntryLine, EntryPlace } from "./entry-places";
import { pickLocalized, pickPlaceName } from "./entry-places";

// 入口のシートの中身。段ごとに 1 つの問いだけを出す

const chipBase =
  "inline-flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 text-left text-[15px] leading-tight font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97]";

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
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.06] pr-2.5 pl-2 text-[13px] leading-none font-semibold">
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
            className={cn(chipBase, "bg-foreground/[0.05] hover:bg-foreground/[0.09]")}
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
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-focus">
            <span aria-hidden className="size-2 rounded-full bg-focus" />
            {pickPlaceName(place, locale)}
          </p>
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

export function DestinationStep({
  originName,
  line,
  suggestions,
  onSelect,
  onFreeText,
}: {
  originName: string;
  line: OriginLine;
  suggestions: EntryHub[];
  onSelect: (station: StationChoice | string) => void;
  onFreeText: (text: string) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  return (
    <>
      <SheetTitle
        eyebrow={
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
            <span className="flex items-center gap-1.5 text-focus">
              <span aria-hidden className="size-2 rounded-full bg-focus" />
              {originName}
            </span>
            <LineTag line={line} suspended={t("suspended")} />
          </p>
        }
        title={t("destinationQuestion")}
      />
      <StationSearch
        hideLabel
        label={t("destinationLabel")}
        placeholder={t("destinationPlaceholder")}
        onSelect={onSelect}
        onFreeText={onFreeText}
        testIds={{
          search: testIds.start.destinationSearch,
          option: testIds.start.destinationOption,
        }}
      />
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-muted">{t("suggestions")}</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((hub) => (
            <button
              key={hub.areaId}
              type="button"
              data-testid={testIds.start.destinationSuggestion(hub.areaId)}
              onClick={() => onSelect(hub.stationName)}
              className={cn(chipBase, "bg-foreground/[0.05] hover:bg-foreground/[0.09]")}
            >
              <MapPin className="size-4 text-muted" strokeWidth={2} aria-hidden />
              {pickLocalized(hub.label, locale)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const methodIcons = { photo: Camera, paste: ClipboardPaste, select: ListChecks } as const;
const methods: SituationTab[] = ["photo", "paste", "select"];

export function TripCard({
  originName,
  destinationName,
  line,
  onEditLine,
  onEditDestination,
}: {
  originName: string;
  destinationName: string;
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
        className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-left hover:bg-foreground/[0.04]"
      >
        <span className="relative size-3.5 shrink-0 rounded-full border-[3px] border-white bg-focus shadow-[0_1px_4px_rgb(0_0_0/0.3)]" />
        <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{originName}</span>
        <LineTag line={line} suspended={t("suspended")} />
      </button>
      <button
        type="button"
        data-testid={testIds.start.editDestination}
        onClick={onEditDestination}
        aria-label={`${t("to")} ${destinationName}・${t("change")}`}
        className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-left hover:bg-foreground/[0.04]"
      >
        <MapPin
          className="relative size-4 shrink-0 -translate-x-px fill-foreground text-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{destinationName}</span>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </button>
    </div>
  );
}

export function MethodStep({ onSelect }: { onSelect: (method: SituationTab) => void }) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle title={t("methodQuestion")} hint={t("methodHint")} />
      <div className="grid grid-cols-3 gap-2">
        {methods.map((method) => {
          const Icon = methodIcons[method];
          return (
            <button
              key={method}
              type="button"
              data-testid={testIds.start.method(method)}
              onClick={() => onSelect(method)}
              className="flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-2xl bg-foreground/[0.05] px-2 py-3 text-center transition-[transform,background-color] duration-150 hover:bg-foreground/[0.09] active:scale-[0.97]"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.12)]">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] leading-tight font-bold">
                  {t(`methods.${method}.title`)}
                </span>
                <span className="text-[11px] leading-tight text-muted">
                  {t(`methods.${method}.note`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function InputStep({
  method,
  catalog,
  busy,
  onSubmit,
}: {
  method: SituationTab;
  catalog: KnowledgeCatalog;
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle title={t(`methods.${method}.heading`)} />
      {method === "photo" && <PhotoPanel busy={busy} onSubmit={onSubmit} />}
      {method === "paste" && <PastePanel busy={busy} onSubmit={onSubmit} />}
      {method === "select" && <SelectPanel catalog={catalog} busy={busy} onSubmit={onSubmit} />}
    </>
  );
}
