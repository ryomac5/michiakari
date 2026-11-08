import type { ResumeChance, ResumeChanceTick } from "@repo/schema";
import type { useTranslations } from "next-intl";

type Translate = ReturnType<typeof useTranslations<"judgment.resumeChance">>;

// 1 割単位の確率の表示。0 は 1 割未満、10 は 9 割以上
export function formatTenths(t: Translate, tenths: number): string {
  if (tenths <= 0) return t("chance.under");
  if (tenths >= 10) return t("chance.over");
  return t("chance.tenths", { n: tenths });
}

// 再開の見込みの図に使う表示用の値。確率は agent の値をそのまま使い、図の上の位置だけを求める
// 横軸は最初の目盛りから最後の目盛りまでの時刻、縦軸は動いている見込み（0〜1）

// 目盛りが境目より前か後か。後は切り替えが得になる時間帯
export type ChanceSide = "before" | "after";
// resumeBy は期限に間に合うために動いていなければならない時刻。到着の期限そのものとは別の時刻
// arrival は電車の中の人の、次の駅に着く見込みの時刻
export type MarkKind = "breakEven" | "resumeBy" | "arrival";

export type ChartPoint = { tick: ResumeChanceTick; x: number; y: number; side: ChanceSide };

export type ChartMark = {
  kind: MarkKind;
  time: string;
  // 横軸の位置。軸の外の時刻は端に寄せ、outside に向きを残す
  x: number;
  outside: "before" | "after" | null;
  // 印の点の高さ。確率が無ければ null で、点を置かない
  tenths: number | null;
};

export type ChanceChart = {
  points: ChartPoint[];
  marks: ChartMark[];
  // いまの位置。軸の外なら null
  now: number | null;
};

export type ChanceChartInput = {
  chance: ResumeChance;
  breakEvenTime: string | null;
  // 画面上の現在。リプレイではシナリオ内の時刻
  nowMs: number | null;
  // 結論が切り替えか。切り替えでは期限の印を置かず、境目の印だけを残す。待てそうに読めるため
  switching?: boolean;
  // 電車の中の人の、次の駅に着く見込みの時刻とその時刻までに動いている確率。あれば境目と期限の代わりに置く
  arrival?: { time: string; tenths: number } | null;
};

function placeOnAxis(startMs: number, spanMs: number, timeMs: number) {
  const raw = spanMs > 0 ? (timeMs - startMs) / spanMs : 0;
  const outside = raw < 0 ? ("before" as const) : raw > 1 ? ("after" as const) : null;
  return { x: Math.min(1, Math.max(0, raw)), outside };
}

export function buildChanceChart(input: ChanceChartInput): ChanceChart {
  const { chance } = input;
  const startMs = Date.parse(chance.ticks[0]?.time ?? "");
  const endMs = Date.parse(chance.ticks.at(-1)?.time ?? "");
  const spanMs = endMs - startMs;
  const breakEvenMs = input.breakEvenTime === null ? null : Date.parse(input.breakEvenTime);
  const points = chance.ticks.map(
    (tick): ChartPoint => ({
      tick,
      x: placeOnAxis(startMs, spanMs, Date.parse(tick.time)).x,
      y: tick.tenths / 10,
      side: breakEvenMs !== null && Date.parse(tick.time) > breakEvenMs ? "after" : "before",
    }),
  );
  // 期限が理由でタクシーを勧めるときは、境目が期限に間に合うために動いていなければならない時刻と同じになる
  // 同じ位置に 2 つの印を重ねないよう、境目の印だけを置き、待って期限に間に合う見込みをその点に出す
  const deadlineIsBreakEven =
    breakEvenMs !== null &&
    chance.resumeByForDeadline !== null &&
    breakEvenMs === Date.parse(chance.resumeByForDeadline);
  const candidates: { kind: MarkKind; time: string | null; tenths: number | null }[] = input.arrival
    ? [{ kind: "arrival", time: input.arrival.time, tenths: input.arrival.tenths }]
    : [
        {
          kind: "breakEven",
          time: input.breakEvenTime,
          tenths: chance.waitFaster ?? (deadlineIsBreakEven ? chance.waitOnTime : null),
        },
        {
          kind: "resumeBy",
          time: deadlineIsBreakEven || input.switching ? null : chance.resumeByForDeadline,
          tenths: chance.waitOnTime,
        },
      ];
  const marks = candidates.flatMap(({ kind, time, tenths }): ChartMark[] => {
    if (time === null) return [];
    const { x, outside } = placeOnAxis(startMs, spanMs, Date.parse(time));
    return [{ kind, time, x, outside, tenths }];
  });
  const nowPlace = input.nowMs === null ? null : placeOnAxis(startMs, spanMs, input.nowMs);
  return { points, marks, now: nowPlace && nowPlace.outside === null ? nowPlace.x : null };
}

// 折れ線と、その下を塗る面の SVG のパス。座標は横 0〜100、縦 0〜100（上が 100%）
export function buildChartPaths(points: readonly ChartPoint[]): { line: string; area: string } {
  if (points.length === 0) return { line: "", area: "" };
  const coords = points.map((p) => `${(p.x * 100).toFixed(2)} ${(100 - p.y * 100).toFixed(2)}`);
  const line = `M ${coords.join(" L ")}`;
  const first = points[0] as ChartPoint;
  const last = points.at(-1) as ChartPoint;
  const area = `${line} L ${(last.x * 100).toFixed(2)} 100 L ${(first.x * 100).toFixed(2)} 100 Z`;
  return { line, area };
}

// 2 つの印の文字が重なるか。文字のおおよその幅は図の幅に対する割合
export function checkLabelsCollide(a: number, b: number, width: number): boolean {
  return Math.abs(a - b) < width;
}

export type ValueSide = "left" | "right";

// 点の数字を置く側。右端に近ければ左に置く。境目と期限が近いときは、左の点を左、右の点を右に分ける
export function selectValueSides(
  marks: readonly ChartMark[],
): Partial<Record<MarkKind, ValueSide>> {
  const sides: Partial<Record<MarkKind, ValueSide>> = {};
  for (const mark of marks) sides[mark.kind] = mark.x > 0.7 ? "left" : "right";
  const [a, b] = marks;
  if (a && b && checkLabelsCollide(a.x, b.x, 0.3)) {
    const [first, second] = a.x <= b.x ? [a, b] : [b, a];
    sides[first.kind] = "left";
    sides[second.kind] = "right";
  }
  return sides;
}
