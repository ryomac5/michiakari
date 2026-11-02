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
  // 分岐点（運転再開の期限）。無ければ null
  breakEvenTime: string | null;
  // 運転再開の見込み時刻（p50・p80）と、分岐点 − 再開見込み p50 の分。見込みが無ければ null
  resumeP50: string | null;
  resumeP80: string | null;
  marginP50Minutes: number | null;
  deadline: string | null;
  bestOption: Pick<RouteOption, "kind" | "label" | "isTransferService"> | null;
};

// 見出しは結論だけの短い一言。理由は比較の形で reason に分ける
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

// 決定論モードの理由。判断の根拠を、時刻どうしの比較の形で 1〜2 文にする
function buildDecisionReason(input: DecisionTextInput): string {
  const ja = input.language === "ja";
  const clock = (iso: string | null) => (iso ? formatClock(iso, input.language) : null);
  const be = clock(input.breakEvenTime);
  const p50 = clock(input.resumeP50);
  const p80 = clock(input.resumeP80);
  const deadline = clock(input.deadline);
  const target = nameSwitchTarget(input.bestOption, input.language);
  switch (input.reason) {
    case "unknown_event":
      return ja
        ? "事象を特定できず、再開の見込みを分岐点と比べられません。"
        : "The cause is unknown, so the outlook cannot be compared with the break-even time.";
    case "no_alternative":
      return ja
        ? "代替手段が見つからず、待つほかに比べる手段がありません。"
        : "No alternative route was found, so there is nothing to compare with waiting.";
    case "break_even_passed":
      if (!be) {
        return ja
          ? `分岐点を過ぎ、いま再開しても${target}より早く着けないためです。`
          : `The break-even time has passed, so even an immediate resumption cannot beat ${target}.`;
      }
      return ja
        ? `分岐点の${be}を過ぎ、いま再開しても${target}より早く着けないためです。`
        : `The break-even time of ${be} has passed, so even an immediate resumption cannot beat ${target}.`;
    case "rain_continuing":
      return ja
        ? "雨が続き、代替経路も止まるおそれがあるため、まだ比べられません。"
        : "Rain continues and alternative routes may also stop, so the options cannot be compared yet.";
    case "low_confidence":
      return ja
        ? "見込みの幅が大きく、まだどちらとも言えません。"
        : "The outlook is still too uncertain to favor either option.";
    case "estimate_extended":
      if (!p80 || !be) {
        return ja
          ? "再開見込みが延長され、さらに延びるおそれがあるためです。"
          : "The resumption estimate was extended and may slip further.";
      }
      return ja
        ? `見込みが延長され、遅めの再開見込み${p80}頃が分岐点${be}より遅いためです。`
        : `The estimate was extended, and the later outlook of ${p80} is past the break-even time of ${be}.`;
    case "resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? "再開見込みが分岐点より遅いためです。"
          : "Resumption is expected after the break-even time.";
      }
      return ja
        ? `再開見込み${p50}頃が、分岐点${be}より遅いためです。`
        : `Resumption is expected around ${p50}, later than the break-even time of ${be}.`;
    case "deadline_risk":
      if (!deadline) {
        return ja
          ? `待つと期限に間に合わず、${target}なら間に合うためです。`
          : `Waiting would miss your deadline, while ${target} would make it.`;
      }
      return ja
        ? `待つと期限の${deadline}に間に合わず、${target}なら間に合うためです。`
        : `Waiting would miss your ${deadline} deadline, while ${target} would make it.`;
    case "resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja
          ? "待つほうが早く着く見込みです。"
          : "Waiting is expected to get you there sooner.";
      }
      // 分岐点をわずかに過ぎる見込みでも、乗り換えの手間を考えて待つ場合がある
      if (input.marginP50Minutes < 0) {
        return ja
          ? `再開見込み${p50}頃と分岐点${be}の差が小さく、乗り換えるほどの差がないためです。`
          : `Resumption around ${p50} is close to the break-even time of ${be}, too close to justify switching.`;
      }
      return ja
        ? `再開見込み${p50}頃が、分岐点${be}より早いためです。`
        : `Resumption is expected around ${p50}, earlier than the break-even time of ${be}.`;
  }
}

function buildDecisionHeadline(input: DecisionTextInput): string {
  const ja = input.language === "ja";
  const target = nameSwitchTarget(input.bestOption, input.language);
  const switchHeadline = ja ? `いま${target}に切り替えてください` : `Switch to ${target} now.`;
  const holdHeadline = ja
    ? "まだ判断できません。分岐点を見てください"
    : "Too early to decide. Watch the break-even time.";
  const waitHeadline = ja ? "運転再開を待ってください" : "Wait for service to resume.";
  switch (input.reason) {
    case "unknown_event":
    case "low_confidence":
      return holdHeadline;
    case "no_alternative":
      return waitHeadline;
    case "rain_continuing":
      return ja ? "雨が続くあいだは判断を保留します" : "Holding off while the rain continues.";
    case "break_even_passed":
    case "estimate_extended":
    case "resume_after_break_even":
    case "deadline_risk":
      return switchHeadline;
    case "resume_before_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      if (minutes === null || minutes <= 0) return waitHeadline;
      return ja ? `あと${minutes}分は待てます` : `You can wait ${minutes} more minutes.`;
    }
  }
}

// 決定論モードの見出しと理由
export function buildDecisionText(input: DecisionTextInput): DecisionText {
  return { headline: buildDecisionHeadline(input), reason: buildDecisionReason(input) };
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
