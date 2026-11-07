"use client";
import { ArrowUp, ChevronRight, HelpCircle, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { OriginLine } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import type { StationChoice } from "@/features/stations/catalog";
import { StationSearch } from "@/features/stations/components/StationSearch";
import { pickStationName } from "@/features/stations/describe";
import { cn } from "@/lib/utils";
import type { DirectionGroup } from "./direction-groups";
import type { DirectionStop, EntryDirection } from "./directions";
import { SheetTitle } from "./EntrySheet";
import type { EntryArea, EntryLine, EntryPlace } from "./entry-places";
import { pickLocalized, pickPlaceName } from "./entry-places";
import { progressSteps } from "./flow";

// 入口のシートの中身。段ごとに 1 つの問いだけを出し、答えはチップを 1 回押せば進む

const chipBase =
  "inline-flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 text-left text-[15px] leading-tight font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97] disabled:opacity-60";
const softChip = "bg-foreground/[0.05] hover:bg-foreground/[0.09]";
// 大きな選択肢の札。2 つを横に並べる
const cardBase =
  "flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition-[transform,background-color] duration-150 active:scale-[0.97]";

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

// 進み具合の印。現在地・行き先・電車・様子の4つを示す
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

// 方面の向きの矢印。地図の方面の札と、駅の札に添える矢印と同じ向きにする
function DirectionArrow({
  color,
  angle,
  small = false,
}: {
  color: string;
  angle: number;
  small?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-white",
        small ? "size-6" : "size-8 shadow-[0_1px_4px_rgb(0_0_0/0.2)]",
      )}
      style={{ backgroundColor: color }}
    >
      <ArrowUp
        className={small ? "size-3.5" : "size-[18px]"}
        strokeWidth={2.75}
        style={{ transform: `rotate(${angle}deg)` }}
      />
    </span>
  );
}

// 行き先の候補を方面ごとに分けて並べる。見出しは「◯◯方面」、駅は近い順
// onSelectDirection があれば見出しも押せ、行き先を決めずに方面だけを選ぶ
function DirectionGroups({
  groups,
  color,
  angles,
  onSelectStop,
  onSelectDirection,
}: {
  groups: DirectionGroup[];
  color: string;
  angles: Record<string, number>;
  onSelectStop: (stop: DirectionStop, direction: EntryDirection) => void;
  onSelectDirection?: (direction: EntryDirection) => void;
}) {
  const nameDirection = useDirectionName();
  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ direction, stops }) => {
        const heading = (
          <>
            <DirectionArrow color={color} angle={angles[direction.key] ?? 0} small />
            <span className="text-[15px] leading-snug font-bold">{nameDirection(direction)}</span>
            {onSelectDirection && (
              <ChevronRight className="size-4 shrink-0 text-muted" strokeWidth={2.25} aria-hidden />
            )}
          </>
        );
        return (
          <section
            key={direction.key}
            data-testid={testIds.start.directionGroup(direction.key)}
            data-direction={nameDirection(direction)}
            aria-label={nameDirection(direction)}
            className="flex flex-col gap-1.5"
          >
            {onSelectDirection ? (
              <button
                type="button"
                data-testid={testIds.start.direction(direction.key)}
                onClick={() => onSelectDirection(direction)}
                className="-mx-1 flex min-h-11 items-center gap-2 self-start rounded-xl px-1 hover:bg-foreground/[0.05]"
              >
                {heading}
              </button>
            ) : (
              <h3 className="flex min-h-8 items-center gap-2">{heading}</h3>
            )}
            {/* 駅を 1 行に並べ、横に送って選ぶ。地図の見える範囲を残す */}
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&>*]:shrink-0 [&>*]:whitespace-nowrap">
              {stops.map((stop) => (
                <StopChip
                  key={stop.choice.id}
                  stop={stop}
                  testId={testIds.start.destinationCandidate(stop.choice.id)}
                  onClick={() => onSelectStop(stop, direction)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function DirectionStep({
  originName,
  line,
  directions,
  angles,
  groups = [],
  onSelect,
  onSelectStop,
}: {
  originName: string;
  line: OriginLine;
  directions: EntryDirection[];
  angles: Record<string, number>;
  // 地図に出した路線の駅を方面ごとにまとめたもの。駅を押すと行き先になり、方面も決まる
  groups?: DirectionGroup[];
  onSelect: (direction: EntryDirection) => void;
  onSelectStop?: (stop: DirectionStop, direction: EntryDirection) => void;
}) {
  const t = useTranslations("entry");
  const locale = useLocale();
  const nameDirection = useDirectionName();
  const withStops = groups.length > 0 && onSelectStop !== undefined;
  return (
    <>
      <SheetTitle
        eyebrow={
          <Eyebrow>
            <HereName name={originName} />
            <LineTag line={line} />
          </Eyebrow>
        }
        title={withStops ? t("lineStopQuestion") : t("directionQuestion")}
        hint={withStops ? undefined : t("directionHint")}
      />
      {withStops && onSelectStop ? (
        <DirectionGroups
          groups={groups}
          color={line.color}
          angles={angles}
          onSelectStop={onSelectStop}
          onSelectDirection={onSelect}
        />
      ) : (
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
      )}
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
  groups = [],
  angles = {},
  routeLines,
  allowUndecided,
  onSelect,
  onSelectGroupStop,
  onSelectLine,
  onUndecided,
  onFreeText,
}: {
  originName: string;
  line: OriginLine | null;
  direction: EntryDirection | null;
  candidates: DirectionStop[];
  // 方面を決める前の候補を方面ごとにまとめたもの。あれば candidates の代わりに出す
  groups?: DirectionGroup[];
  angles?: Record<string, number>;
  // 行き先より先に選べる路線。地図の路線の札と同じものを並べる
  routeLines: EntryLine[];
  allowUndecided: boolean;
  onSelect: (station: StationChoice) => void;
  // まとまりの駅を押したとき。押した駅のまとまりの方面を添える
  onSelectGroupStop?: (stop: DirectionStop, direction: EntryDirection) => void;
  onSelectLine: (line: EntryLine) => void;
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
            {line && <LineTag line={line} />}
          </Eyebrow>
        }
        title={t("destinationQuestion")}
        // 方面が無いときの「行き先の駅を選んでください」は見出しの言い直しなので出さない
        hint={
          direction
            ? t("destinationHint", { direction: pickLocalized(direction.label, locale) })
            : undefined
        }
      />
      {routeLines.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={t("routeLinesLabel")}>
          <p className="text-[13px] font-semibold text-muted">
            {t("routeLinesLabel")}
            <span className="ml-1.5 font-medium">{t("routeLinesHint")}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {routeLines.map((routeLine) => (
              <LineButton
                key={routeLine.key}
                line={routeLine}
                testId={testIds.start.routeLine(routeLine.key)}
                onClick={() => onSelectLine(routeLine)}
              />
            ))}
          </div>
        </section>
      )}
      {groups.length > 0 && line && onSelectGroupStop && (
        <DirectionGroups
          groups={groups}
          color={line.color}
          angles={angles}
          onSelectStop={onSelectGroupStop}
        />
      )}
      {groups.length === 0 && (
        <div
          className={cn(
            "flex flex-wrap gap-2 overflow-y-auto",
            routeLines.length > 0 ? "max-h-28" : "max-h-48",
          )}
        >
          {candidates.map((stop) => (
            <StopChip
              key={stop.choice.id}
              stop={stop}
              testId={testIds.start.destinationCandidate(stop.choice.id)}
              onClick={() => onSelect(stop.choice)}
            />
          ))}
          {direction && allowUndecided && (
            <button
              type="button"
              data-testid={testIds.start.destinationUndecided}
              onClick={onUndecided}
              aria-label={`${t("destinationUndecided")}・${direction ? nameDirection(direction) : ""}`}
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
          )}
        </div>
      )}
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

// 行き先と出発の札。様子の最初の問いの上で、ここまでの答えをまとめて見せる
export function TripCard({
  originName,
  originNote,
  routeDirection,
  destinationName,
  destinationNote,
  line,
  onEditLine,
  onEditDestination,
}: {
  originName: string;
  originNote: string | null;
  // 乗る方面。出発の行に路線と並べて出し、押すと路線と方面を選び直せる
  routeDirection: string | null;
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
        data-testid={routeDirection ? testIds.start.routeSummary : testIds.start.editLine}
        onClick={onEditLine}
        aria-label={`${t("from")} ${originName}・${t("change")}`}
        className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-foreground/[0.04]"
      >
        <span className="relative size-3.5 shrink-0 rounded-full border-[3px] border-white bg-focus shadow-[0_1px_4px_rgb(0_0_0/0.3)]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[16px] font-bold">{originName}</span>
          {originNote && <span className="text-[12px] text-muted">{originNote}</span>}
          {/* 路線と方面を 1 行に並べ、収まらなければ折り返す */}
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <LineTag line={line} suspended={t("suspended")} />
            {routeDirection && <span className="text-[12px] text-muted">{routeDirection}</span>}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
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
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
    </div>
  );
}
