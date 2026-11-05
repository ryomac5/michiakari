"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { pickStationName } from "@/features/stations/describe";
import type { DirectionStop } from "./directions";
import { SheetTitle } from "./EntrySheet";
import { type EntryLine, pickLocalized } from "./entry-places";

const buttonClass = "min-h-12 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-left font-semibold";

export function LocationStep({ onSelect }: { onSelect: (location: "station" | "train") => void }) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle title={t("locationQuestion")} />
      <button
        type="button"
        className={buttonClass}
        data-testid={testIds.start.positionStation}
        onClick={() => onSelect("station")}
      >
        {t("locationStation")}
      </button>
      <button
        type="button"
        className={buttonClass}
        data-testid={testIds.start.positionTrain}
        onClick={() => onSelect("train")}
      >
        {t("locationTrain")}
      </button>
    </>
  );
}

export function TrainLineStep({
  lines,
  onSelect,
}: {
  lines: EntryLine[];
  onSelect: (line: EntryLine) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  return (
    <>
      <SheetTitle title={t("trainLineQuestion")} />
      <input
        className={buttonClass}
        data-testid={testIds.start.trainLineSearch}
        aria-label={t("trainLineSearch")}
        placeholder={t("trainLineSearch")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {lines
          .filter((line) =>
            `${line.name.ja} ${line.name.en} ${line.operator.ja} ${line.operator.en}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((line) => (
            <button
              type="button"
              className={buttonClass}
              key={line.key}
              data-testid={testIds.start.line(line.key)}
              onClick={() => onSelect(line)}
            >
              {pickLocalized(line.name, locale)}
            </button>
          ))}
      </div>
    </>
  );
}

export function TrainPositionStep({
  stops,
  initialIndex,
  onBetween,
  onNearStop,
}: {
  stops: DirectionStop[];
  initialIndex: number;
  onBetween: (from: DirectionStop, to: DirectionStop) => void;
  onNearStop: (stop: DirectionStop) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const [index, setIndex] = useState(initialIndex);
  const from = stops[index];
  const to = stops[index + 1];
  return (
    <>
      <SheetTitle title={t("trainSegmentQuestion")} hint={t("trainSegmentHint")} />
      <select
        className={buttonClass}
        data-testid={testIds.start.trainSegment}
        aria-label={t("trainSegmentQuestion")}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
      >
        {stops.slice(0, -1).map((stop, i) => (
          <option key={stop.choice.id} value={i}>
            {pickStationName(stop.choice, locale)} →{" "}
            {stops[i + 1] ? pickStationName((stops[i + 1] ?? stop).choice, locale) : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={buttonClass}
        data-testid={testIds.start.positionBetween}
        disabled={!from || !to}
        onClick={() => from && to && onBetween(from, to)}
      >
        {t("trainSegmentConfirm")}
      </button>
      <p className="text-sm text-muted">{t("trainStoppedHint")}</p>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {stops.map((stop) => (
          <button
            type="button"
            className={buttonClass}
            key={stop.choice.id}
            data-testid={testIds.start.nearStop(stop.choice.id)}
            onClick={() => onNearStop(stop)}
          >
            {pickStationName(stop.choice, locale)}
          </button>
        ))}
      </div>
    </>
  );
}
