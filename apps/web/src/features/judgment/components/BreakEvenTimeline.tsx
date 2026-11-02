"use client";

import { Flag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  buildBreakEvenTimeline,
  type ResumeRelation,
  type BreakEvenTimeline as Timeline,
  type TimelineBasis,
} from "../break-even-timeline";
import { testIds } from "../testids";
import { formatClockTime } from "../time";

// 分岐点と再開見込みの関係を横 1 本の時間軸で示す。観測が進むと帯と目盛りが滑らかに動く
// 動きは motion-reduce と globals.css の prefers-reduced-motion の規則で止まる

const motion = "transition-[left,width] duration-700 ease-out motion-reduce:transition-none";
const nowMotion = "transition-[left] duration-300 ease-linear motion-reduce:transition-none";

// 下段の文字のおおよその幅（軸の長さに対する割合）。目盛りの時刻と重なるものを間引くのに使う
const labelWidths = { now: 0.1, deadline: 0.17, tick: 0.12 } as const;
// 端からこの割合より内側なら中央寄せ、外側なら内側へ寄せる
const labelReach = { breakEven: 0.18, now: 0.06, deadline: 0.09 } as const;

const relationText: Record<ResumeRelation, string> = {
  before: "text-wait",
  straddle: "text-hold",
  after: "text-switch",
};

type Align = "start" | "center" | "end";

function toPercent(position: number): string {
  return `${(position * 100).toFixed(3)}%`;
}

// 文字の寄せ方。端に近いものは軸からはみ出さないよう内側へ寄せる
function selectAlign(position: number, reach: number): Align {
  if (position < reach) return "start";
  if (position > 1 - reach) return "end";
  return "center";
}

const alignClass: Record<Align, string> = {
  start: "translate-x-0",
  center: "-translate-x-1/2",
  end: "-translate-x-full",
};

function measureExtent(position: number, width: number, align: Align): [number, number] {
  if (align === "start") return [position, position + width];
  if (align === "end") return [position - width, position];
  return [position - width / 2, position + width / 2];
}

// いま・期限の文字と重ならない目盛りだけに時刻を付ける
function selectTickLabels(timeline: Timeline): Set<number> {
  const { now, deadline } = timeline.positions;
  const occupied = [measureExtent(now, labelWidths.now, selectAlign(now, labelReach.now))];
  if (deadline !== null) {
    occupied.push(
      measureExtent(deadline, labelWidths.deadline, selectAlign(deadline, labelReach.deadline)),
    );
  }
  return new Set(
    timeline.ticks
      .filter((tick) => {
        const [from, to] = measureExtent(tick.position, labelWidths.tick, "center");
        return from >= 0 && to <= 1 && occupied.every(([a, b]) => to < a || from > b);
      })
      .map((tick) => tick.ms),
  );
}

// 半分開いたシートに出す時間軸の全体。色の意味は閉じた状態の ResumeCaption が言葉で添える
export function BreakEvenTimeline({ basis, now }: { basis: TimelineBasis; now: Date }) {
  const t = useTranslations("judgment.breakEven.timeline");
  const locale = useLocale();
  const timeline = buildBreakEvenTimeline({ ...basis, now });
  const { positions, relation } = timeline;
  const clock = (ms: number) => formatClockTime(new Date(ms).toISOString(), locale);
  const range = { from: clock(timeline.resumeP50Ms), to: clock(timeline.resumeP80Ms) };
  const tickLabels = selectTickLabels(timeline);
  const at = (position: number): CSSProperties => ({ left: toPercent(position) });
  const span = (from: number, to: number): CSSProperties => ({
    left: toPercent(from),
    width: toPercent(Math.max(to - from, 0)),
  });

  const dataset = {
    "data-relation": relation,
    "data-break-even": basis.breakEvenTime,
    "data-resume-p50": new Date(timeline.resumeP50Ms).toISOString(),
    "data-resume-p80": new Date(timeline.resumeP80Ms).toISOString(),
  };
  const summary = (
    <span className="sr-only">
      {t(`summary.${relation}`, { ...range, breakEven: clock(timeline.breakEvenMs) })}
      {positions.deadline !== null &&
        basis.deadline !== null &&
        ` ${t("deadline", { time: clock(Date.parse(basis.deadline)) })}`}
    </span>
  );

  return (
    <figure
      data-testid={testIds.judgment.breakEvenTimeline}
      {...dataset}
      className="m-0 flex flex-col gap-1"
    >
      <div className="relative h-[50px]" aria-hidden>
        {/* 軸。分岐点より後ろは切り替えが得になる時間帯として薄く塗る */}
        <div className="absolute inset-x-0 top-[18px] h-[12px] overflow-hidden rounded-full bg-foreground/[0.07]">
          <div
            className={cn("absolute inset-y-0 right-0 bg-switch-border/15", motion)}
            style={at(positions.breakEven)}
          />
          {timeline.ticks.map((tick) => (
            <span
              key={tick.ms}
              className={cn("absolute bottom-0 h-1 w-px animate-fade-in bg-muted/50", motion)}
              style={at(tick.position)}
            />
          ))}
          {timeline.bandBefore && (
            <div
              className={cn("absolute inset-y-[2px] min-w-1 rounded-full bg-wait-border", motion)}
              style={span(timeline.bandBefore.from, timeline.bandBefore.to)}
            />
          )}
          {timeline.bandAfter && (
            <div
              className={cn(
                "absolute inset-y-[2px] min-w-1 rounded-full border border-switch-border bg-hatch-switch",
                motion,
              )}
              style={span(timeline.bandAfter.from, timeline.bandAfter.to)}
            />
          )}
          {/* 最も見込みの高い時刻（p50） */}
          <span
            className={cn("absolute inset-y-0 w-[2px] -translate-x-1/2 bg-foreground/70", motion)}
            style={at(positions.resumeP50)}
          />
        </div>

        {/* 分岐点。縦線と時刻で示す */}
        <span
          className={cn(
            "absolute top-[14px] h-[20px] w-[2px] -translate-x-1/2 rounded-full bg-foreground",
            motion,
          )}
          style={at(positions.breakEven)}
        />
        <AxisLabel
          position={positions.breakEven}
          align={selectAlign(positions.breakEven, labelReach.breakEven)}
          className={cn("top-0 font-semibold", motion)}
        >
          {t("breakEven", { time: clock(timeline.breakEvenMs) })}
        </AxisLabel>

        {/* いま */}
        <span
          className={cn(
            "absolute top-[17px] size-[14px] -translate-x-1/2 rounded-full border-[3px] border-surface bg-foreground shadow-sm",
            nowMotion,
          )}
          style={at(positions.now)}
        />
        <AxisLabel
          position={positions.now}
          align={selectAlign(positions.now, labelReach.now)}
          className={cn("top-[35px] font-semibold", nowMotion)}
        >
          {t("now")}
        </AxisLabel>

        {/* 期限（終電や約束）。点線と旗で示す */}
        {positions.deadline !== null && basis.deadline !== null && (
          <>
            <span
              className={cn(
                "absolute top-[14px] h-[20px] -translate-x-1/2 border-l-2 border-dotted border-danger",
                motion,
              )}
              style={at(positions.deadline)}
            />
            <AxisLabel
              position={positions.deadline}
              align={selectAlign(positions.deadline, labelReach.deadline)}
              className={cn(
                "top-[35px] flex items-center gap-0.5 font-semibold text-danger",
                motion,
              )}
            >
              <Flag className="size-3" aria-hidden />
              {clock(Date.parse(basis.deadline))}
            </AxisLabel>
          </>
        )}

        {/* 目盛りの時刻 */}
        {timeline.ticks
          .filter((tick) => tickLabels.has(tick.ms))
          .map((tick) => (
            <AxisLabel
              key={tick.ms}
              position={tick.position}
              align="center"
              className={cn("top-[35px] animate-fade-in text-[11px] text-muted", motion)}
            >
              {clock(tick.ms)}
            </AxisLabel>
          ))}
      </div>

      <figcaption>{summary}</figcaption>
    </figure>
  );
}

// 閉じたシートの 1 行。「おおよその再開 23:43〜23:58 は分岐点より後」。色の見本を添える
export function ResumeCaption({ basis, now }: { basis: TimelineBasis; now: Date }) {
  const t = useTranslations("judgment.breakEven.timeline");
  const locale = useLocale();
  const timeline = buildBreakEvenTimeline({ ...basis, now });
  const clock = (ms: number) => formatClockTime(new Date(ms).toISOString(), locale);
  const range = { from: clock(timeline.resumeP50Ms), to: clock(timeline.resumeP80Ms) };

  return (
    <p
      data-testid={testIds.judgment.breakEvenResume}
      data-relation={timeline.relation}
      className="flex items-center gap-1.5 text-[13px] leading-5 text-muted"
    >
      <RelationSwatch relation={timeline.relation} />
      <span className="min-w-0 truncate tabular-nums">
        {t.rich(`caption.${timeline.relation}`, {
          ...range,
          em: (chunks) => (
            <strong className={cn("font-semibold", relationText[timeline.relation])}>
              {chunks}
            </strong>
          ),
        })}
      </span>
    </p>
  );
}

function AxisLabel({
  position,
  align,
  className,
  children,
}: {
  position: number;
  align: Align;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute text-xs leading-[14px] whitespace-nowrap tabular-nums",
        alignClass[align],
        className,
      )}
      style={{ left: toPercent(position) }}
    >
      {children}
    </span>
  );
}

// 凡例の見本。帯と同じ塗り分けで、分岐点を越えた部分は斜線
function RelationSwatch({ relation }: { relation: ResumeRelation }) {
  return (
    <span className="flex h-2.5 w-6 shrink-0 overflow-hidden rounded-full" aria-hidden>
      {relation !== "after" && <span className="flex-1 bg-wait-border" />}
      {relation !== "before" && (
        <span className="flex-1 border border-switch-border bg-hatch-switch" />
      )}
    </span>
  );
}
