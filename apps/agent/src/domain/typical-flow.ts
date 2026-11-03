import type { Lang, TypicalFlow } from "@repo/schema";
import { decisionParams } from "../config.ts";

// よくある流れを、結論の言葉に使える形にまとめる。数値は知見から core が求めた値だけを使う

// short: 短く終わり、慌てず待てる。long: 時間はかかるが、見込みは立てやすい
// 見込みが立てやすい事象でなければ null
export type FlowOutlook = "short" | "long";

export function classifyFlowOutlook(flow: TypicalFlow | null): FlowOutlook | null {
  if (flow?.predictability.level !== "high") return null;
  return flow.untilResume.p80 <= decisionParams.shortFlowMaxMinutes ? "short" : "long";
}

// 長くかかる事象の目安の分。下限があれば下限、無ければ再開までの p50
export function selectTypicalMinutes(flow: TypicalFlow): number {
  return flow.typicalFloorMinutes ?? flow.untilResume.p50;
}

// 「1時間」「1時間30分」「45分」。英語は時間ちょうどだけ hour で書く
export function formatDuration(minutes: number, language: Lang): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (language === "en") {
    if (hours > 0 && rest === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
    return `${minutes} min`;
  }
  if (hours === 0) return `${minutes}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

// 結論の理由の頭に置く一文。「人身事故は、再開まで1時間ほどかかるのがふつうです。」
export function buildFlowSentence(
  flow: TypicalFlow,
  eventName: string,
  outlook: FlowOutlook,
  language: Lang,
): string {
  const ja = language === "ja";
  if (outlook === "short") {
    const { p50, p80 } = flow.untilResume;
    const span = p50 === p80 ? `${p80}` : ja ? `${p50}〜${p80}` : `${p50}–${p80}`;
    return ja
      ? `${eventName}は${span}分ほどで終わることが多いです。`
      : `${eventName}: usually over in about ${span} min.`;
  }
  const duration = formatDuration(selectTypicalMinutes(flow), language);
  return ja
    ? `${eventName}は、再開まで${duration}ほどかかるのがふつうです。`
    : `${eventName}: service usually resumes in about ${duration}.`;
}
