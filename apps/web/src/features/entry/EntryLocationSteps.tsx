"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";
import { pickStationName } from "@/features/stations/describe";
import type { DirectionStop } from "./directions";
import { SheetTitle } from "./EntrySheet";
import { type EntryLine, pickLocalized } from "./entry-places";
import type { GpsChoice } from "./gps-candidates";
import type { GpsStatus } from "./use-gps-position";

const buttonClass = "min-h-12 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-left font-semibold";

export type GpsProps = {
  status: GpsStatus;
  // 地図で線を押して出した候補か。端末の位置を使っていないので、位置の扱いの説明を出さない
  fromMap?: boolean;
  choices: GpsChoice[];
  onLocate: () => void;
  onConfirm: (choice: GpsChoice) => void;
  onDismiss: () => void;
};

// 候補の呼び名。問いの形と、並べたときの形の 2 つ
function useGpsLabel() {
  const t = useTranslations("entry");
  const locale = useLocale();
  return (choice: GpsChoice, form: "question" | "choice") =>
    choice.kind === "station"
      ? t(form === "question" ? "gpsStationQuestion" : "gpsStationChoice", {
          station: pickStationName(choice.choice, locale),
        })
      : t(form === "question" ? "gpsBetweenQuestion" : "gpsBetweenChoice", {
          line: pickLocalized(choice.line.name, locale),
          from: pickStationName(choice.from, locale),
          to: pickStationName(choice.to, locale),
        });
}

const gpsFailureKeys = {
  denied: "gpsDenied",
  unavailable: "gpsUnavailable",
  unsupported: "gpsUnsupported",
} as const;

// 現在地から読み取る。候補が 1 つなら はい で確定し、複数なら近い順に並べて選ばせる
function GpsLocate({ status, choices, onLocate, onConfirm, onDismiss, fromMap }: GpsProps) {
  const t = useTranslations("entry");
  const label = useGpsLabel();
  const located = status.kind === "located";
  const failure =
    status.kind === "failed"
      ? t(gpsFailureKeys[status.reason])
      : located && choices.length === 0
        ? t("gpsNone")
        : null;
  const [only] = choices;
  return (
    <div className="flex flex-col gap-2" data-testid={testIds.start.gps} data-status={status.kind}>
      {located && only && choices.length === 1 ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-foreground/[0.05] p-3">
          <p className="font-semibold" data-testid={testIds.start.gpsQuestion}>
            {label(only, "question")}
          </p>
          {/* はいは主のボタン、違うは控えめなボタンにし、押せることがひと目で分かるようにする */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              data-testid={testIds.start.gpsConfirm}
              onClick={() => onConfirm(only)}
            >
              {t("gpsYes")}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              data-testid={testIds.start.gpsDismiss}
              onClick={onDismiss}
            >
              {t("gpsNo")}
            </Button>
          </div>
        </div>
      ) : located && choices.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{t("gpsPickQuestion")}</p>
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.key}
              className={buttonClass}
              data-testid={testIds.start.gpsChoice(choice.key)}
              onClick={() => onConfirm(choice)}
            >
              {label(choice, "choice")}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className={buttonClass}
          data-testid={testIds.start.gpsLocate}
          disabled={status.kind === "locating"}
          onClick={onLocate}
        >
          {status.kind === "locating" ? t("gpsLocating") : t("gpsLocate")}
        </button>
      )}
      {failure ? (
        <p className="text-sm text-muted" data-testid={testIds.start.gpsStatus} role="status">
          {failure} {t("gpsUndergroundNote")}
        </p>
      ) : fromMap ? null : (
        <p className="text-xs text-muted">{t("gpsNote")}</p>
      )}
    </div>
  );
}

// 最初の段。現在地の読み取り、駅名の検索、地図、車内の順に並べる
export function LocationStep({
  onSelect,
  gps,
  children,
}: {
  onSelect: (location: "station" | "train") => void;
  gps: GpsProps;
  children?: ReactNode;
}) {
  const t = useTranslations("entry");
  return (
    <>
      <SheetTitle title={t("question")} />
      <GpsLocate {...gps} />
      {children}
      <button
        type="button"
        className={buttonClass}
        data-testid={testIds.start.positionStation}
        onClick={() => onSelect("station")}
      >
        {t("locationMap")}
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
      <SheetTitle title={t("trainLineQuestion")} hint={t("mapLineHint")} />
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

// 選んでいる駅の間は画面が持ち、地図の点線と同じものを指す
export function TrainPositionStep({
  stops,
  index,
  onIndexChange,
  onBetween,
  onNearStop,
}: {
  stops: DirectionStop[];
  index: number;
  onIndexChange: (index: number) => void;
  onBetween: (from: DirectionStop, to: DirectionStop) => void;
  onNearStop: (stop: DirectionStop) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const setIndex = onIndexChange;
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
