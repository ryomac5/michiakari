import type { FlowOutlook } from "@repo/core";
import type { Lang, TypicalFlow } from "@repo/schema";

// よくある流れを、結論の言葉に使える形にまとめる。数値は知見から core が求めた値だけを使う
// 短く終わるか長くかかるかの区別は、画面と同じ閾値を使うため core に置く
export { classifyFlowOutlook, type FlowOutlook } from "@repo/core";

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

// 結論の理由の頭に置く一文。「人身事故はふつう1時間ほどで再開します。」
// 知見の文は使わず、core が求めた分数だけで組み立てる
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
      ? `${eventName}はふつう${span}分で終わります。`
      : `${eventName}: usually over in about ${span} min.`;
  }
  const duration = formatDuration(selectTypicalMinutes(flow), language);
  return ja
    ? `${eventName}はふつう${duration}ほどで再開します。`
    : `${eventName}: service usually resumes in about ${duration}.`;
}
