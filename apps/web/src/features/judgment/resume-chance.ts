import { selectKeyTick } from "@repo/core";
import type { ResumeChance, ResumeChanceTick } from "@repo/schema";

// 時刻ごとの再開の見込みの帯に使う表示用の値。確率は agent の値をそのまま使い、位置と文字の置き場だけを求める

const MS_PER_MINUTE = 60_000;
// 印の文字のおおよその幅、棒の半分の幅、印と文字の間。帯の幅に対する割合
// 文字は 10px で、「分岐点」は約 30px、"Decision" は約 46px。390px 幅の帯に対する割合で渡す
export const markLabelWidths = { ja: 0.09, en: 0.13, icon: 0.035 } as const;
const barHalfWidth = 0.025;
const markGap = 0.012;
// 印の文字は棒の列の上端に置くので、これ以上の確率の棒とだけ重なる
const tallBarTenths = 5;

// 目盛りが分岐点より前か後か。後の棒は切り替えが得になる時間帯として斜線で描く
export type ChanceSide = "before" | "after";
export type MarkKind = "breakEven" | "deadline";
export type LabelSide = "right" | "left" | "hidden";

export type ChanceTickLayout = { tick: ResumeChanceTick; position: number; side: ChanceSide };
export type ChanceMarkLayout = {
  kind: MarkKind;
  time: string;
  position: number;
  labelSide: LabelSide;
  // 文字を置けないときに旗だけを置く側。期限の印だけが持つ
  iconSide: LabelSide | null;
};
// 要点の 1 文に使う目盛りと、いまからの分。いまが分からなければ null
export type ChanceLead = { tick: ResumeChanceTick; fromNowMinutes: number | null };

export type ChanceLayout = {
  ticks: ChanceTickLayout[];
  marks: ChanceMarkLayout[];
  lead: ChanceLead | null;
};

// 目盛り i は等間隔の列の中央 (i + 0.5) / n にある。時刻はその軸に直線で写す
export function computeChancePosition(chance: ResumeChance, timeMs: number): number {
  const first = chance.ticks[0];
  if (!first) return 0;
  const stepMs = chance.stepMinutes * MS_PER_MINUTE;
  return ((timeMs - Date.parse(first.time)) / stepMs + 0.5) / chance.ticks.length;
}

function overlaps(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

// 印の文字の置き場。右に置けなければ左、どちらも棒に重なるなら文字を出さない
export function selectMarkLabelSide(
  position: number,
  barPositions: readonly number[],
  labelWidth: number = markLabelWidths.en,
): LabelSide {
  const bars = barPositions.map((p): [number, number] => [p - barHalfWidth, p + barHalfWidth]);
  const right: [number, number] = [position + markGap, position + markGap + labelWidth];
  const left: [number, number] = [position - markGap - labelWidth, position - markGap];
  if (right[1] <= 1 && bars.every((b) => !overlaps(right, b))) return "right";
  if (left[0] >= 0 && bars.every((b) => !overlaps(left, b))) return "left";
  return "hidden";
}

export type ChanceLayoutInput = {
  chance: ResumeChance;
  breakEvenTime: string | null;
  // 画面上の現在。リプレイではシナリオ内の時刻。無ければ「◯分後」を出さない
  nowMs: number | null;
  // 印の文字の幅。言語で変わる。省略時は英語の幅
  labelWidth?: number;
};

export function buildChanceLayout(input: ChanceLayoutInput): ChanceLayout {
  const { chance } = input;
  const breakEvenMs = input.breakEvenTime === null ? null : Date.parse(input.breakEvenTime);
  const ticks = chance.ticks.map(
    (tick, i): ChanceTickLayout => ({
      tick,
      position: (i + 0.5) / chance.ticks.length,
      side: breakEvenMs !== null && Date.parse(tick.time) > breakEvenMs ? "after" : "before",
    }),
  );
  // 文字は棒の列の上端に置くので、低い棒とは重ならない
  const tallBars = ticks.filter((t) => t.tick.tenths >= tallBarTenths).map((t) => t.position);
  const labelWidth = input.labelWidth ?? markLabelWidths.en;
  // 期限が理由でタクシーを勧めるときは、分岐点が期限に間に合うために動いていなければならない時刻と同じになる
  // 同じ位置に 2 つの印と文字を重ねないよう、分岐点の印だけを置く
  const deadlineIsBreakEven =
    input.breakEvenTime !== null &&
    chance.resumeByForDeadline !== null &&
    Date.parse(input.breakEvenTime) === Date.parse(chance.resumeByForDeadline);
  const candidates: { kind: MarkKind; time: string | null }[] = [
    { kind: "breakEven", time: input.breakEvenTime },
    // 期限の印は、期限に間に合うために動いていなければならない時刻に置く
    { kind: "deadline", time: deadlineIsBreakEven ? null : chance.resumeByForDeadline },
  ];
  const marks = candidates.flatMap(({ kind, time }): ChanceMarkLayout[] => {
    if (time === null) return [];
    const position = computeChancePosition(chance, Date.parse(time));
    if (position < 0 || position > 1) return [];
    const labelSide = selectMarkLabelSide(position, tallBars, labelWidth);
    const iconSide =
      kind === "deadline" && labelSide === "hidden"
        ? selectMarkLabelSide(position, tallBars, markLabelWidths.icon)
        : null;
    return [{ kind, time, position, labelSide, iconSide }];
  });
  const key = selectKeyTick(chance.ticks);
  const lead =
    key === null
      ? null
      : {
          tick: key,
          fromNowMinutes:
            input.nowMs === null
              ? null
              : Math.round((Date.parse(key.time) - input.nowMs) / MS_PER_MINUTE),
        };
  return { ticks, marks, lead };
}

// 棒の高さ。1 割未満でも見えるように最小の高さを持たせる
export function computeBarHeight(tenths: number, maxPx: number): number {
  return Math.max(2, Math.round((tenths / 10) * maxPx));
}
