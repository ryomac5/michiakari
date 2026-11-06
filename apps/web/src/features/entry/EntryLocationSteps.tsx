"use client";

import { Play, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";
import type { StationChoice } from "@/features/stations/catalog";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { pickStationName } from "@/features/stations/describe";
import { cn } from "@/lib/utils";
import type { DirectionStop } from "./directions";
import { SheetTitle } from "./EntrySheet";
import { type EntryLine, pickLocalized } from "./entry-places";
import type { GpsChoice } from "./gps-candidates";
import type { GpsStatus } from "./use-gps-position";

const buttonClass = "min-h-12 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-left font-semibold";
// 16px 未満の入力欄は iPhone で拡大されるので 16px にする
const fieldClass = `${buttonClass} text-[16px]`;
// 最初の段の選び方。幅いっぱいの札にせず、詰めて並べる
const chipClass =
  "inline-flex min-h-11 items-center rounded-full bg-foreground/[0.05] px-3.5 text-[14px] font-semibold transition-colors hover:bg-foreground/[0.09] disabled:opacity-60";

export type GpsProps = {
  status: GpsStatus;
  choices: GpsChoice[];
  onLocate: () => void;
  onConfirm: (choice: GpsChoice) => void;
  onDismiss: () => void;
  // 候補に指を置くかフォーカスしたとき、その候補の key。離れたら null
  onFocusChoice?: (key: string | null) => void;
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

// 位置の候補の確かめ。候補が 1 つなら はい で確定し、複数なら並べて選ばせる
// 並べた候補に指を置くかフォーカスすると onFocusChoice で知らせ、地図でその区間を強く光らせる
function PlaceConfirm({
  choices,
  pickTitle,
  onConfirm,
  onDismiss,
  onFocusChoice,
}: {
  choices: GpsChoice[];
  pickTitle: string;
  onConfirm: (choice: GpsChoice) => void;
  onDismiss: () => void;
  onFocusChoice?: (key: string | null) => void;
}) {
  const t = useTranslations("entry");
  const label = useGpsLabel();
  const [only] = choices;
  if (only && choices.length === 1)
    return (
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
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{pickTitle}</p>
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.key}
          className={buttonClass}
          data-testid={testIds.start.gpsChoice(choice.key)}
          onClick={() => onConfirm(choice)}
          onPointerEnter={() => onFocusChoice?.(choice.key)}
          onPointerDown={() => onFocusChoice?.(choice.key)}
          onPointerLeave={() => onFocusChoice?.(null)}
          onFocus={() => onFocusChoice?.(choice.key)}
          onBlur={() => onFocusChoice?.(null)}
        >
          {label(choice, "choice")}
        </button>
      ))}
    </div>
  );
}

// 現在地から読み取る。読み取れたら候補を確かめる
function GpsLocate({ status, choices, onLocate, onConfirm, onDismiss, onFocusChoice }: GpsProps) {
  const t = useTranslations("entry");
  const located = status.kind === "located";
  const failure =
    status.kind === "failed"
      ? t(gpsFailureKeys[status.reason])
      : located && choices.length === 0
        ? t("gpsNone")
        : null;
  // 読み取る前は 1 つの札だけなので、ほかの選び方と同じ並びに入れる
  const idle = !(located && choices.length > 0) && !failure;
  return (
    <div
      className={idle ? "contents" : "flex w-full flex-col gap-2"}
      data-testid={testIds.start.gps}
      data-status={status.kind}
    >
      {located && choices.length > 0 ? (
        <PlaceConfirm
          choices={choices}
          pickTitle={t("gpsPickQuestion")}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
          onFocusChoice={onFocusChoice}
        />
      ) : (
        <button
          type="button"
          className={cn(chipClass, "self-start")}
          data-testid={testIds.start.gpsLocate}
          disabled={status.kind === "locating"}
          onClick={onLocate}
        >
          {status.kind === "locating" ? t("gpsLocating") : t("gpsLocate")}
        </button>
      )}
      {failure ? (
        <p className="text-sm text-muted" data-testid={testIds.start.gpsStatus} role="status">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

// 最初の段。駅名の検索、現在地の読み取り、駅にいる、駅と駅の間の順に並べる
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
  const tStart = useTranslations("start");
  return (
    <>
      <SheetTitle title={t("question")} />
      {children}
      <div className="flex flex-wrap gap-2">
        <GpsLocate {...gps} />
        <button
          type="button"
          className={chipClass}
          data-testid={testIds.start.positionStation}
          onClick={() => onSelect("station")}
        >
          {t("locationStation")}
        </button>
        <button
          type="button"
          className={chipClass}
          data-testid={testIds.start.positionTrain}
          onClick={() => onSelect("train")}
        >
          {t("locationBetween")}
        </button>
        <Link
          href="/replay"
          data-testid={testIds.start.replayLink}
          className={cn(chipClass, "gap-1.5 bg-brand/10 text-brand hover:bg-brand/15")}
        >
          <Play className="size-3.5 fill-current" aria-hidden />
          {tStart("replayLink")}
        </Link>
      </div>
    </>
  );
}

// 選んだ駅の札。押すとその駅を選び直す
function PickedStation({
  station,
  testId,
  onClear,
}: {
  station: StationChoice;
  testId: string;
  onClear: () => void;
}) {
  const t = useTranslations("entry");
  const name = pickStationName(station, useLocale());
  return (
    <button
      type="button"
      className={cn(chipClass, "shrink-0 gap-1 bg-foreground/[0.08]")}
      data-testid={testId}
      aria-label={t("betweenChangeStation", { station: name })}
      onClick={onClear}
    >
      {name}
      <X className="size-4 text-muted" aria-hidden />
    </button>
  );
}

// 駅と駅の間を選ぶ段。地図の線を押すか、両側の 2 つの駅名で選び、確かめて確定する
// mapChoices は地図の線を押して出した候補。駅名で出した候補より先に確かめる
export function BetweenStep({
  mapChoices,
  onDismissMap,
  listPairChoices,
  onSearch,
  onConfirm,
  onFocusChoice,
}: {
  mapChoices: GpsChoice[] | null;
  onDismissMap: () => void;
  listPairChoices: (first: StationChoice, second: StationChoice) => GpsChoice[];
  onSearch: () => void;
  onConfirm: (choice: GpsChoice) => void;
  onFocusChoice?: (key: string | null) => void;
}) {
  const t = useTranslations("entry");
  const [first, setFirst] = useState<StationChoice | null>(null);
  const [second, setSecond] = useState<StationChoice | null>(null);
  const pairChoices = first && second ? listPairChoices(first, second) : null;
  const choices = mapChoices ?? pairChoices;
  const searchProps = (label: string) => ({
    hideLabel: true,
    label,
    placeholder: label,
  });
  return (
    <>
      <SheetTitle title={t("betweenQuestion")} />
      {choices && choices.length > 0 ? (
        <PlaceConfirm
          choices={choices}
          pickTitle={mapChoices ? t("gpsPickQuestion") : t("betweenPickQuestion")}
          onConfirm={onConfirm}
          onDismiss={mapChoices ? onDismissMap : () => setSecond(null)}
          onFocusChoice={mapChoices ? onFocusChoice : undefined}
        />
      ) : null}
      {!mapChoices && pairChoices?.length === 0 ? (
        <p className="text-sm text-muted" data-testid={testIds.start.betweenPairNone} role="status">
          {t("betweenPairNone")}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-medium text-muted">{t("betweenPairLabel")}</p>
        <div className="flex items-start gap-2">
          {first ? (
            <PickedStation
              station={first}
              testId={testIds.start.betweenFirst}
              onClear={() => {
                setFirst(null);
                setSecond(null);
              }}
            />
          ) : (
            <div className="min-w-0 flex-1">
              <StationSearch
                {...searchProps(t("betweenFirstStation"))}
                onSelect={(station) => {
                  onSearch();
                  setFirst(station);
                }}
                testIds={{
                  search: testIds.start.betweenFirstSearch,
                  option: testIds.start.betweenFirstOption,
                }}
              />
            </div>
          )}
          {first && second ? (
            <PickedStation
              station={second}
              testId={testIds.start.betweenSecond}
              onClear={() => setSecond(null)}
            />
          ) : first ? (
            <div className="min-w-0 flex-1">
              <StationSearch
                {...searchProps(t("betweenSecondStation"))}
                onSelect={(station) => {
                  onSearch();
                  setSecond(station);
                }}
                testIds={{
                  search: testIds.start.betweenSecondSearch,
                  option: testIds.start.betweenSecondOption,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
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
        className={fieldClass}
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
        className={fieldClass}
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
