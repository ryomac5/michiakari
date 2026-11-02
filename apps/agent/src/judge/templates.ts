import { getJstMinuteOfDay } from "@repo/core";
import type { Lang } from "@repo/schema";

// 利用者向けの定型文（ja / en）。数値は呼び出し側がツールの結果から渡す

const pad = (n: number) => String(n).padStart(2, "0");

// 日本時間の時刻表示。ja は「23時16分」、en は「23:16」
export function formatClock(iso: string, language: Lang): string {
  const minute = getJstMinuteOfDay(iso);
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return language === "ja" ? `${h}時${pad(m)}分` : `${pad(h)}:${pad(m)}`;
}

export function buildDisclaimer(language: Lang): string {
  return language === "ja"
    ? "この判断は公開情報と過去の傾向にもとづく推定です。駅や鉄道会社の公式発表を優先してください。"
    : "This judgment is an estimate based on public information and past patterns. Always prioritize official announcements from the station or railway operator.";
}

// 「◯時◯分までに再開しなければ、◯◯のほうが早く着きます」
export function buildBreakEvenSentence(time: string, label: string, language: Lang): string {
  return language === "ja"
    ? `${formatClock(time, language)}までに再開しなければ、${label}のほうが早く着きます。`
    : `If service has not resumed by ${formatClock(time, language)}, ${label} gets you there sooner.`;
}

export function buildPassedSentence(time: string, label: string, language: Lang): string {
  return language === "ja"
    ? `分岐点の${formatClock(time, language)}を過ぎました。いま再開しても${label}のほうが早く着きます。`
    : `The break-even time of ${formatClock(time, language)} has passed. Even if service resumed now, ${label} would be faster.`;
}

export function buildNoAlternativeSentence(language: Lang): string {
  return language === "ja"
    ? "代替手段が見つからないため、分岐点を示せません。"
    : "No alternative route was found, so no break-even time can be shown.";
}

export type DecisionReason =
  | "unknown_event"
  | "no_alternative"
  | "break_even_passed"
  | "rain_continuing"
  | "low_confidence"
  | "estimate_extended"
  | "resume_after_break_even"
  | "deadline_risk"
  | "resume_before_break_even";

export type HeadlineInput = {
  reason: DecisionReason;
  language: Lang;
  breakEvenTime: string | null;
  bestLabel: string | null;
  boardableP50: string | null;
};

// 決定論モードの結論の一文
export function buildHeadline(input: HeadlineInput): string {
  const ja = input.language === "ja";
  const be = input.breakEvenTime ? formatClock(input.breakEvenTime, input.language) : null;
  const best = input.bestLabel ?? (ja ? "代替手段" : "the alternative");
  const boardable = input.boardableP50 ? formatClock(input.boardableP50, input.language) : null;
  switch (input.reason) {
    case "unknown_event":
      return ja
        ? "事象を特定できないため、分岐点を目安に判断してください。"
        : "The cause could not be identified. Use the break-even time as your guide.";
    case "no_alternative":
      return ja
        ? "代替手段が見つからないため、運転再開を待つしかなさそうです。"
        : "No alternative route was found, so waiting for resumption seems to be the only option.";
    case "break_even_passed":
      return ja
        ? `${best}に切り替えましょう。分岐点の${be}を過ぎています。`
        : `Switch to ${best}. The break-even time of ${be} has passed.`;
    case "rain_continuing":
      return ja
        ? `雨が続くあいだは代替経路も止まりやすいため、判断を保留します。${be}までに再開しなければ、${best}のほうが早く着きます。`
        : `While the rain continues, alternatives may also stop, so the decision is on hold. If service has not resumed by ${be}, ${best} gets you there sooner.`;
    case "low_confidence":
      return ja
        ? `まだ見込みの幅が大きい段階です。${be}までに再開しなければ、${best}のほうが早く着きます。`
        : `The outlook is still very uncertain. If service has not resumed by ${be}, ${best} gets you there sooner.`;
    case "estimate_extended":
      return ja
        ? `${best}に切り替えましょう。再開見込みが延びており、さらに延びると${be}の分岐点を過ぎます。`
        : `Switch to ${best}. The resumption estimate has been extended, and a further delay would pass the break-even time of ${be}.`;
    case "resume_after_break_even":
      return ja
        ? `${best}に切り替えましょう。再開して乗れる見込みの${boardable}頃では、${best}より遅く着きます。`
        : `Switch to ${best}. Boarding around ${boardable} after resumption would arrive later than ${best}.`;
    case "deadline_risk":
      return ja
        ? `${best}に切り替えましょう。待つと期限に間に合わない見込みです。`
        : `Switch to ${best}. Waiting is likely to miss your deadline.`;
    case "resume_before_break_even":
      return ja
        ? `運転再開を待ちましょう。${boardable}頃に乗れる見込みです。${be}までに再開しなければ、${best}のほうが早く着きます。`
        : `Wait for resumption. You should be able to board around ${boardable}. If service has not resumed by ${be}, ${best} gets you there sooner.`;
  }
}
