"use client";

import type { ResumeChance } from "@repo/schema";
import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type CSSProperties, useId } from "react";
import { cn } from "@/lib/utils";
import type { ResumeRelation } from "../break-even-timeline";
import {
  buildChanceChart,
  buildChartPaths,
  type ChartMark,
  checkLabelsCollide,
  formatTenths,
  selectValueSides,
  type ValueSide,
} from "../resume-chance";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 再開の見込みを 1 つの図で示す。横は時刻、縦は動いている見込み
// 線の下を淡く塗り、いまと境目と期限に縦の印を付ける。数字は境目と期限の点にだけ添える
// 確率は agent の値をそのまま出し、画面では計算しない。目盛りの値は読み上げ用の一覧で伝える

type Translate = ReturnType<typeof useTranslations<"judgment.resumeChance">>;

// 印の文字のおおよその幅。図の幅に対する割合
const labelWidth = { now: 0.12, breakEven: 0.26 } as const;
const motion = "transition-[left,top] duration-700 ease-out motion-reduce:transition-none";

function formatDuration(t: Translate, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("duration.minutes", { minutes });
  if (rest === 0) return t("duration.hours", { hours });
  return t("duration.hoursMinutes", { hours, minutes: rest });
}

function toHhmm(iso: string): string {
  return formatClockTime(iso, "en").replace(":", "");
}

function toPercent(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

// 端に近い文字は図からはみ出さないよう内側へ寄せる
function alignAt(x: number): string {
  if (x < 0.12) return "translate-x-0";
  if (x > 0.88) return "-translate-x-full";
  return "-translate-x-1/2";
}

export function ResumeChanceChart({
  chance,
  breakEvenTime,
  now,
  showOnset,
  relation,
  switching = false,
}: {
  chance: ResumeChance;
  breakEvenTime: string | null;
  // 画面上の現在。リプレイではシナリオ内の時刻。初回の描画では null
  now: Date | null;
  // 「発生から」を出すか。入口で止まってからの時間を答えていないときは出さない
  showOnset: boolean;
  // 再開見込みの幅と境目の位置関係。従来の 1 行の見込みと同じ属性で出す
  relation: ResumeRelation | null;
  // 結論が切り替えか。切り替えでは期限の印と期限の文を出さない
  switching?: boolean;
}) {
  const t = useTranslations("judgment.resumeChance");
  const locale = useLocale();
  const chart = buildChanceChart({
    chance,
    breakEvenTime,
    nowMs: now?.getTime() ?? null,
    switching,
  });
  const paths = buildChartPaths(chart.points);
  const clock = (iso: string) => formatClockTime(iso, locale);
  const onsetKnown = showOnset && chance.onsetTime !== null;
  const sinceOnset = onsetKnown ? (chance.ticks[0]?.sinceOnsetMinutes ?? null) : null;
  const breakEven = chart.marks.find((m) => m.kind === "breakEven") ?? null;
  // 期限に間に合うために動いていなければならない時刻。到着の期限とは別の時刻なので「間に合う再開」と呼ぶ
  const deadline = chart.marks.find((m) => m.kind === "resumeBy") ?? null;
  const valueSides = selectValueSides(chart.marks);
  // 線の下の面は、境目より前を待つ色、後を切り替える色で塗り分ける
  const split = breakEven ? breakEven.x * 100 : 100;
  const clipId = `chance-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const showNowLabel =
    chart.now !== null &&
    (breakEven === null ||
      !checkLabelsCollide(chart.now, breakEven.x, (labelWidth.now + labelWidth.breakEven) / 2));
  // 軸の時刻は、最初と最後と、その間の印に重ならないものだけを出す
  const axisTicks = chart.points.filter(
    (p, i) =>
      i === 0 ||
      i === chart.points.length - 1 ||
      chart.marks.every((m) => !checkLabelsCollide(p.x, m.x, 0.1)),
  );

  return (
    <section
      data-testid={testIds.judgment.breakEvenResume}
      data-kind="chance"
      data-relation={relation ?? undefined}
      aria-labelledby="resume-chance-title"
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="resume-chance-title" className="text-[13px] font-semibold">
          {t("title")}
        </h3>
        {sinceOnset !== null && (
          <p
            data-testid={testIds.judgment.resumeChanceOnset}
            className="text-[12px] text-muted tabular-nums"
          >
            {t("onset", { since: formatDuration(t, sinceOnset) })}
          </p>
        )}
      </div>
      <figure
        data-testid={testIds.judgment.resumeChance}
        data-step={chance.stepMinutes}
        data-wait-faster={chance.waitFaster ?? ""}
        data-wait-on-time={chance.waitOnTime ?? ""}
        data-onset={onsetKnown ? "known" : "unknown"}
        className="m-0 flex flex-col gap-1"
      >
        {/* 印の文字の段 */}
        <div className="relative h-[18px] text-[11px] leading-[18px] font-semibold" aria-hidden>
          {chart.now !== null && showNowLabel && (
            <span
              className={cn("absolute text-muted", alignAt(chart.now), motion)}
              style={{ left: toPercent(chart.now) }}
            >
              {t("marks.now")}
            </span>
          )}
          {breakEven && (
            <span
              className={cn(
                "absolute flex items-center gap-1 whitespace-nowrap",
                alignAt(breakEven.x),
                motion,
              )}
              style={{ left: toPercent(breakEven.x) }}
            >
              {t("marks.breakEven")}
              <time
                data-testid={testIds.judgment.breakEvenTime}
                dateTime={breakEven.time}
                className="tabular-nums"
              >
                {clock(breakEven.time)}
              </time>
            </span>
          )}
          {deadline && (
            <span
              className={cn(
                "absolute flex items-center gap-0.5 whitespace-nowrap text-danger",
                alignAt(deadline.x),
                motion,
              )}
              style={{ left: toPercent(deadline.x) }}
            >
              <Clock className="size-3" aria-hidden />
            </span>
          )}
        </div>
        {/* 図の本体。線と面は伸び縮みする SVG、印と数字は重ねた要素で描く */}
        <div className="relative h-[76px]">
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <clipPath id={`${clipId}-before`}>
                <rect x={0} y={-10} width={split} height={120} />
              </clipPath>
              <clipPath id={`${clipId}-after`}>
                <rect x={split} y={-10} width={100 - split} height={120} />
              </clipPath>
            </defs>
            {[0, 50, 100].map((y) => (
              <line
                key={y}
                x1={0}
                x2={100}
                y1={y}
                y2={y}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={y === 100 ? undefined : "2 3"}
                className={y === 100 ? "stroke-foreground/25" : "stroke-foreground/10"}
              />
            ))}
            <path
              d={paths.area}
              clipPath={`url(#${clipId}-before)`}
              className="fill-wait-border/25 transition-[d] duration-700 ease-out motion-reduce:transition-none"
            />
            <path
              d={paths.area}
              clipPath={`url(#${clipId}-after)`}
              className="fill-foreground/[0.07] transition-[d] duration-700 ease-out motion-reduce:transition-none"
            />
            <path
              d={paths.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-wait-border transition-[d] duration-700 ease-out motion-reduce:transition-none"
            />
          </svg>
          {/* 半々の線の目安 */}
          <span
            aria-hidden
            className="absolute top-1/2 right-0 -translate-y-full pb-px text-[10px] leading-none text-muted"
          >
            {t("half")}
          </span>
          {chart.now !== null && (
            <span
              aria-hidden
              className={cn("absolute inset-y-0 w-px bg-foreground/35", motion)}
              style={{ left: toPercent(chart.now) }}
            />
          )}
          {deadline && <MarkLine mark={deadline} />}
          {breakEven && <MarkLine mark={breakEven} />}
          {breakEven && (
            <MarkValue
              mark={breakEven}
              testId={
                chance.waitFaster !== null
                  ? testIds.judgment.resumeChanceWaitFaster
                  : testIds.judgment.resumeChanceWaitOnTime
              }
              label={t(chance.waitFaster !== null ? "waitFaster" : "waitOnTime")}
              side={valueSides.breakEven ?? "right"}
              t={t}
            />
          )}
          {deadline && (
            <MarkValue
              mark={deadline}
              testId={testIds.judgment.resumeChanceWaitOnTime}
              label={t("waitOnTime")}
              side={valueSides.resumeBy ?? "right"}
              t={t}
            />
          )}
        </div>
        {/* 横軸の時刻 */}
        <div
          className="relative h-[14px] text-[11px] leading-[14px] text-muted tabular-nums"
          aria-hidden
        >
          {axisTicks.map((p) => (
            <span
              key={p.tick.time}
              className={cn("absolute whitespace-nowrap", alignAt(p.x))}
              style={{ left: toPercent(p.x) }}
            >
              {clock(p.tick.time)}
            </span>
          ))}
        </div>
        {/* 間に合う再開の時刻の意味。到着の期限と取り違えないよう、図の下に文で添える */}
        {deadline && (
          <p
            data-testid={testIds.judgment.resumeChanceResumeBy}
            className="flex items-center gap-1 text-[12px] font-semibold text-danger"
          >
            <Clock className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0">
              {t.rich("marks.resumeBy", {
                time: clock(deadline.time),
                clock: (chunks) => (
                  <time dateTime={deadline.time} className="tabular-nums">
                    {chunks}
                  </time>
                ),
              })}
            </span>
          </p>
        )}
        {/* 目盛りごとの値。読み上げと検証に使う */}
        <ol className="sr-only">
          {chart.points.map((p) => (
            <li
              key={p.tick.time}
              data-testid={testIds.judgment.resumeChanceTick(toHhmm(p.tick.time))}
              data-tenths={p.tick.tenths}
              data-since-onset={p.tick.sinceOnsetMinutes ?? ""}
              data-time={p.tick.time}
              data-side={p.side}
            >
              {t("sr.tick", { time: clock(p.tick.time), chance: formatTenths(t, p.tick.tenths) })}
            </li>
          ))}
        </ol>
      </figure>
    </section>
  );
}

// 境目と期限の縦の印
function MarkLine({ mark }: { mark: ChartMark }) {
  const deadline = mark.kind === "resumeBy";
  return (
    <span
      aria-hidden
      data-testid={
        deadline ? testIds.judgment.resumeChanceDeadline : testIds.judgment.resumeChanceBreakEven
      }
      data-time={mark.time}
      data-outside={mark.outside ?? ""}
      className={cn(
        "absolute inset-y-0 -translate-x-1/2",
        deadline ? "border-l-2 border-dotted border-danger" : "w-0.5 rounded-full bg-foreground",
        motion,
      )}
      style={{ left: toPercent(mark.x) }}
    />
  );
}

// 印の上の点と、その時刻までに動く見込みの数字
function MarkValue({
  mark,
  testId,
  label,
  side,
  t,
}: {
  mark: ChartMark;
  testId: string;
  label: string;
  side: ValueSide;
  t: Translate;
}) {
  if (mark.tenths === null) return null;
  const deadline = mark.kind === "resumeBy";
  // 点は確率の高さに置く。数字は点の斜め上に置き、高い点では斜め下に回す
  const top = `${((1 - mark.tenths / 10) * 100).toFixed(2)}%`;
  const below = mark.tenths >= 7;
  const dot: CSSProperties = { left: toPercent(mark.x), top };
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface",
          deadline ? "border-danger" : "border-foreground",
          motion,
        )}
        style={dot}
      />
      <dl
        data-testid={testId}
        data-tenths={mark.tenths}
        className={cn(
          "absolute m-0 rounded-md bg-surface px-1 py-0.5 leading-none shadow-sm ring-1 ring-border",
          side === "right" ? "ml-2" : "-ml-2 -translate-x-full",
          below ? "mt-2" : "-mt-2 -translate-y-full",
          motion,
        )}
        style={{ left: toPercent(mark.x), top }}
      >
        <dt className="sr-only">{label}</dt>
        <dd
          className={cn(
            "m-0 text-[15px] font-bold whitespace-nowrap tabular-nums",
            deadline && "text-danger",
          )}
        >
          {formatTenths(t, mark.tenths)}
        </dd>
      </dl>
    </>
  );
}
