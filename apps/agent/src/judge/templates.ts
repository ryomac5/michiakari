import { getJstMinuteOfDay } from "@repo/core";
import type { Lang, ProgressStage, RouteOption } from "@repo/schema";

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

export type DecisionTextInput = {
  reason: DecisionReason;
  language: Lang;
  // 分岐点までの分。待てる残りの時間として見出しに使う
  breakEvenMinutesFromNow: number | null;
  bestOption: Pick<RouteOption, "kind" | "label" | "isTransferService"> | null;
  boardableP50: string | null;
};

// 見出しは結論だけの短い一言。理由や経緯は reason に分ける
export type DecisionText = {
  headline: string;
  reason: string;
};

// 切り替え先の呼び名。見出しを短く保つため、経路名ではなく手段の種類で呼ぶ
function nameSwitchTarget(option: DecisionTextInput["bestOption"], language: Lang): string {
  const ja = language === "ja";
  if (option?.kind === "taxi") return ja ? "タクシー" : "a taxi";
  if (option?.kind === "walk") return ja ? "徒歩" : "walking";
  if (option?.isTransferService) return ja ? "振替" : "the transfer service";
  return ja ? "別の路線" : "another line";
}

// 決定論モードの見出しと理由
export function buildDecisionText(input: DecisionTextInput): DecisionText {
  const ja = input.language === "ja";
  const best = input.bestOption?.label ?? (ja ? "代替手段" : "the alternative");
  const boardable = input.boardableP50 ? formatClock(input.boardableP50, input.language) : null;
  const target = nameSwitchTarget(input.bestOption, input.language);
  const switchHeadline = ja ? `いま${target}に切り替えてください` : `Switch to ${target} now.`;
  const holdHeadline = ja
    ? "まだ判断できません。分岐点を見てください"
    : "Too early to decide. Watch the break-even time.";
  switch (input.reason) {
    case "unknown_event":
      return {
        headline: holdHeadline,
        reason: ja ? "事象を特定できていません。" : "The cause could not be identified.",
      };
    case "no_alternative":
      return {
        headline: ja ? "運転再開を待ってください" : "Wait for service to resume.",
        reason: ja ? "代替手段が見つかりません。" : "No alternative route was found.",
      };
    case "break_even_passed":
      return {
        headline: switchHeadline,
        reason: ja
          ? "待ち続けても、代替手段より早くは着けません。"
          : "Waiting can no longer beat the alternative.",
      };
    case "rain_continuing":
      return {
        headline: ja ? "雨が続くあいだは判断を保留します" : "Holding off while the rain continues.",
        reason: ja
          ? "雨が続くあいだは、代替経路も止まりやすくなります。"
          : "While the rain continues, alternative routes may also stop.",
      };
    case "low_confidence":
      return {
        headline: holdHeadline,
        reason: ja ? "まだ見込みの幅が大きい段階です。" : "The outlook is still very uncertain.",
      };
    case "estimate_extended":
      return {
        headline: switchHeadline,
        reason: ja
          ? "再開見込みが延びました。さらに延びるおそれがあります。"
          : "The resumption estimate was extended and may slip further.",
      };
    case "resume_after_break_even":
      return {
        headline: switchHeadline,
        reason: ja
          ? `再開して乗れるのは${boardable}頃の見込みで、${best}より遅く着きます。`
          : `Boarding after resumption is expected around ${boardable}, arriving later than ${best}.`,
      };
    case "deadline_risk":
      return {
        headline: switchHeadline,
        reason: ja
          ? "待つと期限に間に合わない見込みです。"
          : "Waiting is likely to miss your deadline.",
      };
    case "resume_before_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      const canWait = minutes !== null && minutes > 0;
      return {
        headline: canWait
          ? ja
            ? `あと${minutes}分は待てます`
            : `You can wait ${minutes} more minutes.`
          : ja
            ? "運転再開を待ってください"
            : "Wait for service to resume.",
        reason: ja
          ? `${boardable}頃に乗れる見込みです。`
          : `You should be able to board around ${boardable}.`,
      };
    }
  }
}

// 理由と分岐点の説明をつなぐ。理由は後で Judgment の専用欄へ移す
export function joinReasonAndExplanation(
  reason: string,
  explanation: string,
  language: Lang,
): string {
  return language === "ja" ? `${reason}${explanation}` : `${reason} ${explanation}`;
}

const PROGRESS_MESSAGES: Record<ProgressStage, { ja: string; en: string }> = {
  interpret: { ja: "掲示や発表を読み取っています", en: "Reading the announcement" },
  knowledge: { ja: "元指令員の知見を確かめています", en: "Checking the dispatcher knowledge" },
  weather: { ja: "雨量と警報を確かめています", en: "Checking rainfall and warnings" },
  phase: {
    ja: "段階と再開までの時間を見積もっています",
    en: "Estimating the phase and time to resumption",
  },
  alternatives: { ja: "代替経路を探しています", en: "Searching for alternative routes" },
  break_even: { ja: "分岐点を計算しています", en: "Computing the break-even time" },
  judgment: { ja: "判断をまとめています", en: "Putting the judgment together" },
};

// 各段階の開始を知らせる短文
export function buildProgressMessage(stage: ProgressStage, language: Lang): string {
  return PROGRESS_MESSAGES[stage][language];
}
