"use client";

import type { ResumeChance } from "@repo/schema";
import { Flag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ResumeRelation } from "../break-even-timeline";
import {
  buildChanceLayout,
  type ChanceLead,
  type ChanceMarkLayout,
  computeBarHeight,
} from "../resume-chance";
import { testIds } from "../testids";
import { formatClockTime } from "../time";
import { NoBreakText } from "./NoBreakText";

// 時刻ごとの再開の見込み。切りのよい時刻ごとに動いている確率を小さな棒で積み上げ、分岐点と期限の位置に印を付ける
// 上に、待ったほうが早く着く見込みの数字と、要点の 1 文を置く。帯の中身は読み上げ用の文でも伝える
// 確率は agent の値をそのまま出し、画面では計算しない

const barMaxPx = 22;
const barMotion = "transition-[height] duration-700 ease-out motion-reduce:transition-none";

type Translate = ReturnType<typeof useTranslations<"judgment.resumeChance">>;

// 1 割単位の確率の表示。0 は 1 割未満、10 は 9 割以上。棒の上は短い形にする
function formatTenths(t: Translate, tenths: number, compact = false): string {
  const group = compact ? "bar" : "chance";
  if (tenths <= 0) return t(`${group}.under`);
  if (tenths >= 10) return t(`${group}.over`);
  return t(`${group}.tenths`, { n: tenths });
}

function formatDuration(t: Translate, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("duration.minutes", { minutes });
  if (rest === 0) return t("duration.hours", { hours });
  return t("duration.hoursMinutes", { hours, minutes: rest });
}

// 「1時間20分後の 23:30 には、6割の見込みで動いています」。発生が分かれば「発生から」の言い方を添える
function buildLeadText(t: Translate, locale: string, lead: ChanceLead, showOnset: boolean): string {
  const time = formatClockTime(lead.tick.time, locale);
  const chance = formatTenths(t, lead.tick.tenths);
  const since = showOnset ? lead.tick.sinceOnsetMinutes : null;
  const fromNow =
    lead.fromNowMinutes !== null && lead.fromNowMinutes >= 1 ? lead.fromNowMinutes : null;
  if (since !== null && fromNow !== null && since !== fromNow) {
    return t("lead.both", {
      since: formatDuration(t, since),
      fromNow: formatDuration(t, fromNow),
      time,
      chance,
    });
  }
  if (since !== null)
    return t("lead.sinceOnset", { since: formatDuration(t, since), time, chance });
  if (fromNow !== null)
    return t("lead.fromNow", { fromNow: formatDuration(t, fromNow), time, chance });
  return t("lead.plain", { time, chance });
}

function toHhmm(iso: string): string {
  return formatClockTime(iso, "en").replace(":", "");
}

export function ResumeChanceBand({
  chance,
  breakEvenTime,
  now,
  showOnset,
  relation,
}: {
  chance: ResumeChance;
  breakEvenTime: string | null;
  // 画面上の現在。リプレイではシナリオ内の時刻。初回の描画では null
  now: Date | null;
  // 「発生から」の言い方を出すか。入口で止まってからの時間を答えていないときは出さない
  showOnset: boolean;
  // 再開見込みの幅と分岐点の位置関係。従来の 1 行の見込みと同じ属性で出す
  relation: ResumeRelation | null;
}) {
  const t = useTranslations("judgment.resumeChance");
  const locale = useLocale();
  const layout = buildChanceLayout({ chance, breakEvenTime, nowMs: now?.getTime() ?? null });
  const clock = (iso: string) => formatClockTime(iso, locale);
  const onsetKnown = showOnset && chance.onsetTime !== null;

  const stats = [
    {
      kind: "waitFaster" as const,
      tenths: chance.waitFaster,
      testId: testIds.judgment.resumeChanceWaitFaster,
    },
    {
      kind: "waitOnTime" as const,
      tenths: chance.waitOnTime,
      testId: testIds.judgment.resumeChanceWaitOnTime,
    },
  ].filter((s): s is typeof s & { tenths: number } => s.tenths !== null);

  const srParts = [
    t("sr.ticks", {
      items: chance.ticks
        .map((tick) =>
          t("sr.tick", { time: clock(tick.time), chance: formatTenths(t, tick.tenths) }),
        )
        .join(locale === "ja" ? "、" : ", "),
    }),
    chance.waitFaster === null
      ? null
      : t("sr.waitFaster", { chance: formatTenths(t, chance.waitFaster) }),
    chance.waitOnTime === null || chance.resumeByForDeadline === null
      ? null
      : t("sr.waitOnTime", {
          time: clock(chance.resumeByForDeadline),
          chance: formatTenths(t, chance.waitOnTime),
        }),
  ].filter((part): part is string => part !== null);

  return (
    <section
      data-testid={testIds.judgment.breakEvenResume}
      data-kind="chance"
      data-relation={relation ?? undefined}
      aria-labelledby="resume-chance-title"
      className="flex flex-col gap-1.5"
    >
      <h3 id="resume-chance-title" className="sr-only">
        {t("title")}
      </h3>
      {/* 判断の根拠の数字。待ったほうが早く着く見込みと、待って期限に間に合う見込み */}
      {stats.length > 0 && (
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
          {stats.map((stat) => (
            <div
              key={stat.kind}
              data-testid={stat.testId}
              data-tenths={stat.tenths}
              className="flex items-baseline gap-1.5"
            >
              <dt className="text-[13px] text-muted">{t(stat.kind)}</dt>
              <dd className="text-[17px] leading-none font-bold tabular-nums">
                {formatTenths(t, stat.tenths)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {layout.lead && (
        <p
          data-testid={testIds.judgment.resumeChanceLead}
          data-time={layout.lead.tick.time}
          className="text-[13px] leading-5 text-muted"
        >
          <NoBreakText text={buildLeadText(t, locale, layout.lead, onsetKnown)} />
        </p>
      )}
      <figure
        data-testid={testIds.judgment.resumeChance}
        data-step={chance.stepMinutes}
        data-wait-faster={chance.waitFaster ?? ""}
        data-wait-on-time={chance.waitOnTime ?? ""}
        data-onset={onsetKnown ? "known" : "unknown"}
        className="m-0 flex flex-col gap-1"
      >
        <div className="relative" aria-hidden>
          <ol className="flex">
            {layout.ticks.map(({ tick, side }) => (
              <li
                key={tick.time}
                data-testid={testIds.judgment.resumeChanceTick(toHhmm(tick.time))}
                data-tenths={tick.tenths}
                data-since-onset={tick.sinceOnsetMinutes ?? ""}
                data-time={tick.time}
                data-side={side}
                className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
              >
                <span className="text-[11px] leading-[14px] font-semibold whitespace-nowrap tabular-nums">
                  {formatTenths(t, tick.tenths, true)}
                </span>
                <span className="flex h-[22px] w-full items-end justify-center">
                  <span
                    className={cn(
                      "w-[14px] rounded-t-[3px]",
                      side === "after"
                        ? "border border-b-0 border-switch-border bg-hatch-switch"
                        : "bg-wait-border",
                      barMotion,
                    )}
                    style={{ height: `${computeBarHeight(tick.tenths, barMaxPx)}px` }}
                  />
                </span>
                <span className="text-[11px] leading-[14px] text-muted whitespace-nowrap tabular-nums">
                  {clock(tick.time)}
                </span>
              </li>
            ))}
          </ol>
          {layout.marks.map((mark) => (
            <Mark key={mark.kind} mark={mark} label={t(`marks.${mark.kind}`)} />
          ))}
        </div>
        <figcaption className="sr-only">{srParts.join(" ")}</figcaption>
      </figure>
    </section>
  );
}

// 分岐点と期限の印。縦線と短い文字。文字は棒に重ならない側に置く
function Mark({ mark, label }: { mark: ChanceMarkLayout; label: string }) {
  const left = `${(mark.position * 100).toFixed(3)}%`;
  const deadline = mark.kind === "deadline";
  return (
    <>
      <span
        data-testid={
          deadline ? testIds.judgment.resumeChanceDeadline : testIds.judgment.resumeChanceBreakEven
        }
        data-time={mark.time}
        data-label-side={mark.labelSide}
        className={cn(
          "absolute top-0 h-[38px] -translate-x-1/2",
          deadline
            ? "border-l-2 border-dotted border-danger"
            : "w-[2px] rounded-full bg-foreground",
        )}
        style={{ left }}
      />
      {mark.labelSide !== "hidden" && (
        <span
          className={cn(
            "absolute top-[15px] flex items-center gap-0.5 text-[10px] leading-[12px] font-semibold whitespace-nowrap",
            deadline ? "text-danger" : "text-foreground",
            mark.labelSide === "right" ? "ml-1.5" : "-ml-1.5 -translate-x-full",
          )}
          style={{ left }}
        >
          {deadline && <Flag className="size-2.5" aria-hidden />}
          {label}
        </span>
      )}
    </>
  );
}
