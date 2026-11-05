import { type ConcreteTrainType, getJstMinuteOfDay, type TrainQueueDelay } from "@repo/core";
import type { Lang, ProgressStage, RouteOption, WeatherTrend } from "@repo/schema";
import { headlineLimits, reasonLimits } from "../config.ts";
import type { FlowOutlook } from "../domain/typical-flow.ts";

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
    ? "公開情報と過去の傾向にもとづく推定です。駅や鉄道会社の公式発表を優先する。"
    : "This is an estimate from public information and past patterns. Follow official station or railway announcements first.";
}

// 英語の経路ラベル（文頭用の「Via ◯◯」など）を、文の途中で主語になる名詞句にする
// 定型のラベルだけを言い換え、それ以外（固有名詞で始まるものなど）はそのまま使う
const EN_LABEL_IN_SENTENCE: readonly [RegExp, string][] = [
  [/^Transfer service via /, "the transfer service via "],
  [/^Via /, "the route via "],
  [/^Taxi$/, "a taxi"],
  [/^Walk$/, "walking"],
];

export function formatLabelInSentence(label: string, language: Lang): string {
  if (language === "ja") return label;
  for (const [pattern, replacement] of EN_LABEL_IN_SENTENCE) {
    if (pattern.test(label)) return label.replace(pattern, replacement);
  }
  return label;
}

// 分岐点は再開の条件と比較先の到着を一文で示す
export function buildBreakEvenSentence(
  time: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}より待つほうが早く着きます。`
    : `Resuming by ${formatClock(time, language)} makes waiting at least as fast as ${route} arriving at ${formatClock(arrival, language)}.`;
}

export function buildPassedSentence(
  time: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}より待つほうが早い境目でした。`
    : `Resuming by ${formatClock(time, language)} would have made waiting at least as fast as ${route} arriving at ${formatClock(arrival, language)}.`;
}

// 期限から求めた境目は、代替手段との早着の比較には使わない
export function buildDeadlineBreakEvenSentence(
  time: string,
  deadline: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}に切り替えず期限に間に合います。`
    : `Resuming by ${formatClock(time, language)} lets you meet your ${formatClock(deadline, language)} deadline without switching to ${route} arriving at ${formatClock(arrival, language)}.`;
}

export function buildDeadlinePassedSentence(
  time: string,
  deadline: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}を過ぎた今は${formatClock(deadline, language)}の期限に向け${formatClock(arrival, language)}着の${route}に切り替える。`
    : `After ${formatClock(time, language)}, switch to ${route} arriving at ${formatClock(arrival, language)} to meet your ${formatClock(deadline, language)} deadline.`;
}

export function buildNoAlternativeSentence(language: Lang): string {
  return language === "ja"
    ? "待つ場合と到着時刻を比べられる代わりの経路がないためいまはこのまま運転再開を待つ。"
    : "Wait for service to resume because no alternative arrival is available for comparison.";
}

export type DecisionReason =
  | "unknown_event"
  | "no_alternative"
  | "break_even_passed"
  | "rain_continuing"
  | "low_confidence"
  | "estimate_extended"
  | "resume_after_break_even"
  | "resume_mostly_after_break_even"
  | "deadline_risk"
  | "resume_before_break_even"
  // 原因が分からず、発表の再開見込みの時刻だけを根拠に分岐点と比べた
  | "stated_resume_after_break_even"
  | "stated_resume_before_break_even";

// 1 割単位の確率の表示。0 は 1 割未満、10 は 9 割以上で、0 割と 10 割は書かない
export function formatChance(tenths: number, language: Lang): string {
  if (tenths <= 0) return language === "ja" ? "1割未満" : "under 10%";
  if (tenths >= 10) return language === "ja" ? "9割以上" : "over 90%";
  return language === "ja" ? `${tenths}割` : `${tenths * 10}%`;
}

export type ChanceTextInput = {
  // 見込みの幅や延長後の遅めの見込みを根拠にした判断
  laterOutlook?: boolean;
  // 待ったほうが早く着く確率。代替手段が無ければ null
  waitFaster: number | null;
  // 判断で比較した分岐点の再開時刻。分岐点が無ければ null
  comparisonTime?: string | null;
  // 待って期限に間に合うための再開時刻。期限か待つ経路が無ければ null
  deadlineResumeTime?: string | null;
  // 待って期限に間に合う確率。期限が無ければ null
  waitOnTime: number | null;
  // 通常は5割に達する最初の目盛り、無ければ最後
  // laterOutlookなら分岐点後の8割以上の最初、無ければ分岐点後の最初
  keyTick: { time: string; tenths: number } | null;
};

// 判断で比較した時刻の再開確率を一文で示す。数値はツールの結果からそのまま渡す
export function buildChanceSentence(chance: ChanceTextInput, language: Lang): string | null {
  const ja = language === "ja";
  if (chance.waitFaster !== null) {
    const c = formatChance(chance.waitFaster, language);
    if (chance.comparisonTime) {
      const time = formatClock(chance.comparisonTime, language);
      return ja
        ? `分岐点の${time}までに再開する見込みは${c}です。`
        : `The chance of resuming by ${time} is ${c}.`;
    }
    return ja
      ? `待ったほうが早く着く見込みは${c}です。`
      : `The chance that waiting gets you there sooner is ${c}.`;
  }
  if (chance.waitOnTime !== null) {
    const c = formatChance(chance.waitOnTime, language);
    if (chance.deadlineResumeTime) {
      const time = formatClock(chance.deadlineResumeTime, language);
      return ja
        ? `期限に間に合う再開の境目は${time}です。その時刻までの再開見込みは${c}です。`
        : `Restart by ${time} to meet your deadline by waiting. The chance is ${c}.`;
    }
    return ja
      ? `待って期限に間に合う見込みは${c}です。`
      : `The chance of making your deadline by waiting is ${c}.`;
  }
  if (chance.keyTick) {
    const c = formatChance(chance.keyTick.tenths, language);
    const clock = formatClock(chance.keyTick.time, language);
    if (chance.laterOutlook) {
      return ja
        ? `遅めの見込みでは分岐点より後の${clock}までの再開確率は${c}です。`
        : `Later outlook: ${c} chance of restart by ${clock}. This is after the decision point.`;
    }
    return ja ? `${clock}までに再開する見込みは${c}です。` : `Chance of restart by ${clock}: ${c}.`;
  }
  return null;
}

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
  // 期限が理由でタクシーを勧めるときだけ、分岐点を求めた期限。分岐点は、待っても期限に間に合う最後の再開の時刻になる
  deadlineBasis?: string | null;
  bestOption: Pick<RouteOption, "kind" | "label" | "isTransferService"> | null;
  // 見込みが立てやすい事象のよくある流れ。inReason は理由の頭に流れの一文を置くか
  flow?: { outlook: FlowOutlook; sentence: string; inReason: boolean } | null;
  // 待ったほうが早く着く確率など。理由の最後に 1 文で添える。無ければ添えない
  chance?: ChanceTextInput | null;
  // 駅間の車内にいる利用者。結論は次の駅に着いてからの行動で書く
  trainQueue?: TrainQueueText | null;
};

export type TrainQueueText = {
  // ホームに着けて降りられる駅
  alightStation: string;
  arrivalP50: string | null;
  beforeResume: boolean;
  trainsAheadCount: number;
  // 前の列車をふだんの間隔で先を走っていたとみなしたか。目の前に詰まっているとみなしたなら false
  spacedByHeadway: boolean;
  ownTrainType: ConcreteTrainType;
  delays: readonly TrainQueueDelay[];
  // 切り替え先で最初に乗る路線名。無ければ手段の種類で呼ぶ
  switchLine: string | null;
};

const TRAIN_TYPE_NAMES: Record<ConcreteTrainType, { ja: string; en: string }> = {
  local: { ja: "普通", en: "local train" },
  rapid: { ja: "快速", en: "rapid train" },
  special_rapid: { ja: "新快速", en: "special rapid train" },
  limited_express: { ja: "特急", en: "limited express" },
};

export function formatTrainType(type: ConcreteTrainType, language: Lang): string {
  return TRAIN_TYPE_NAMES[type][language];
}

// 上限に収まる最初の候補。どれも収まらなければ最後の候補
function pickFitting(candidates: readonly string[], max: number): string {
  return candidates.find((c) => [...c].length <= max) ?? candidates.at(-1) ?? "";
}

// 駅間の車内の見出し。その場で取れる行動の言葉にし、「あと N 分」のような時間の指示は使わない
function buildTrainQueueHeadline(
  queue: TrainQueueText,
  action: "switch" | "wait",
  target: string,
  language: Lang,
): string {
  const ja = language === "ja";
  const st = queue.alightStation;
  const max = headlineLimits[language].max;
  if (action === "wait") {
    return pickFitting(
      ja
        ? [`${st}に着いてもそのまま乗る`, `${st}でも降りずに乗る`]
        : [`Stay on the train when you reach ${st}.`, `Stay on past ${st}.`],
      max,
    );
  }
  const line = queue.switchLine;
  if (line) {
    return pickFitting(
      ja
        ? [
            `${st}に着いたら降りて${line}に乗り換える`,
            `${st}で降りて${line}へ向かう`,
            `${st}で降りて乗り換える`,
          ]
        : [
            `When you reach ${st}, get off and change to the ${line}.`,
            `Get off at ${st} and take the ${line}.`,
            `Get off at ${st} and change trains.`,
          ],
      max,
    );
  }
  return pickFitting(
    ja
      ? [`${st}に着いたら降りて${target}に切り替える`, `${st}で降りて${target}へ`]
      : [`When you reach ${st}, get off and switch to ${target}.`, `Get off at ${st} and switch.`],
    max,
  );
}

// 次の駅に着く見込みの一文。種別の事情があればそれを先に言う
// ホームがふさがっている事情と、その種別がその駅に止まれない事情は、文の上で分ける
function buildTrainQueueNote(queue: TrainQueueText, language: Lang): string | null {
  if (!queue.arrivalP50) return null;
  const ja = language === "ja";
  const st = queue.alightStation;
  const time = formatClock(queue.arrivalP50, language);
  const delay = queue.delays[0];
  const own = formatTrainType(queue.ownTrainType, language);
  if (delay?.kind === "ahead_cannot_stop") {
    const type = formatTrainType(delay.trainType, language);
    return ja
      ? `${st}には再開後の${time}ごろに着く見込みです。前の${type}は${delay.station}に止まれず手前で止まっています。`
      : `Expect to reach ${st} around ${time} after service resumes. The ${type} ahead cannot stop at ${delay.station} and is held short of it.`;
  }
  if (delay?.kind === "platform_occupied") {
    const type = formatTrainType(delay.occupiedBy, language);
    return ja
      ? `${st}には再開後の${time}ごろに着く見込みです。${delay.station}のホームに前の${type}が止まっています。`
      : `Expect to reach ${st} around ${time} after service resumes. A ${type} ahead occupies the platform at ${delay.station}.`;
  }
  if (delay?.kind === "own_cannot_stop") {
    return ja
      ? `降りられる${st}には${time}ごろに着く見込みです。${own}は${delay.station}に止まれません。`
      : `Expect your first stop at ${st} around ${time}. Your ${own} cannot stop at ${delay.station}.`;
  }
  const n = queue.trainsAheadCount;
  if (queue.spacedByHeadway) {
    return ja
      ? queue.beforeResume
        ? `${st}には${time}ごろに着く見込みです。前の列車との間隔はふだんどおりと仮定しています。`
        : `${st}には再開後の${time}ごろに着く見込みです。前の列車との間隔はふだんどおりと仮定しています。`
      : queue.beforeResume
        ? `Expect to reach ${st} around ${time}. This assumes usual spacing to trains ahead.`
        : `Expect to reach ${st} around ${time} after service resumes. This assumes usual spacing to trains ahead.`;
  }
  if (queue.beforeResume) {
    if (n === 0) {
      return ja
        ? `${st}には${time}ごろに着く見込みです。前に列車はいません。`
        : `Expect to reach ${st} around ${time}. There are no trains ahead.`;
    }
    return ja
      ? `前の列車が順に進めば${st}には${time}ごろに着く見込みです。`
      : `Expect to reach ${st} around ${time} if trains ahead move up.`;
  }
  if (n === 0) {
    return ja
      ? `${st}には再開後の${time}ごろに着く見込みです。`
      : `Expect to reach ${st} around ${time} after service resumes.`;
  }
  return ja
    ? `${st}には${time}ごろに着く見込みです。前に${n}本つまっています。`
    : `Expect to reach ${st} around ${time}. There are ${n} trains ahead.`;
}

function buildShortTrainQueueNote(queue: TrainQueueText, language: Lang): string | null {
  if (!queue.arrivalP50) return null;
  const time = formatClock(queue.arrivalP50, language);
  return language === "ja"
    ? `${queue.alightStation}に着くのは${time}ごろの見込みです。`
    : `You should reach ${queue.alightStation} around ${time}.`;
}

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

// 期限が理由でタクシーを勧めるときの理由。分岐点は、待っても期限に間に合う最後の再開の時刻なので、
// 「分岐点を過ぎるとタクシーのほうが早く着く」ではなく、待っては期限に間に合わないと書く。当てはまらない理由は null
function buildDeadlineBasisReason(input: DecisionTextInput): string | null {
  const ja = input.language === "ja";
  const clock = (iso: string | null | undefined) => (iso ? formatClock(iso, input.language) : null);
  const be = clock(input.breakEvenTime);
  const limit = clock(input.deadlineBasis);
  if (!be || !limit) return null;
  const p50 = clock(input.resumeP50);
  const p80 = clock(input.resumeP80);
  switch (input.reason) {
    case "unknown_event":
      return ja
        ? `${be}を過ぎると待っては期限の${limit}に間に合いません。`
        : `After ${be}, waiting misses your ${limit} deadline.`;
    case "low_confidence":
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると待っては期限の${limit}に間に合いません。再開見込みには幅があります。`
          : `The outlook is still wide. After ${be}, waiting will miss your ${limit} deadline.`;
      }
      return ja
        ? `${be}を過ぎると待っては期限の${limit}に間に合いません。再開見込みは${p50}〜${p80}頃です。`
        : `Resumption is expected between ${p50} and ${p80}. After ${be}, waiting will miss your ${limit} deadline.`;
    case "break_even_passed":
      return ja
        ? `分岐点${be}を過ぎています。いま再開しても期限の${limit}に間に合いません。`
        : `Even if service resumes now, waiting misses your ${limit} deadline. The ${be} decision point has passed.`;
    case "stated_resume_after_break_even":
      if (!p50) return null;
      return ja
        ? `発表の再開見込み${p50}は分岐点${be}より後です。見込みどおりでも期限の${limit}に間に合いません。`
        : `Announced restart ${p50} is after the ${be} decision point. Waiting misses your ${limit} deadline even if it holds.`;
    case "stated_resume_before_break_even":
      if (!p50 || (input.marginP50Minutes ?? 0) < 0) return null;
      return ja
        ? `発表の再開見込み${p50}は分岐点${be}より前です。見込みどおりなら期限の${limit}に間に合います。`
        : `Announced restart ${p50} is before the ${be} decision point. Wait to meet your ${limit} deadline if it holds.`;
    default:
      return null;
  }
}

// 決定論モードの理由。判断の根拠を、時刻どうしの比較の形で 1〜2 文にする
function buildDecisionReason(input: DecisionTextInput): string {
  const byDeadline = buildDeadlineBasisReason(input);
  if (byDeadline !== null) return byDeadline;
  const ja = input.language === "ja";
  const clock = (iso: string | null) => (iso ? formatClock(iso, input.language) : null);
  const be = clock(input.breakEvenTime);
  const p50 = clock(input.resumeP50);
  const p80 = clock(input.resumeP80);
  const deadline = clock(input.deadline);
  const target = nameSwitchTarget(input.bestOption, input.language);
  switch (input.reason) {
    // 保留のときも謝らず、分岐点を過ぎたら何が早いかを比べる形で書く。次に確かめることは画面が別に示す
    case "unknown_event":
      if (!be) {
        return ja
          ? "待つ場合と比べられる代わりの経路がないため運転再開を待ちます。"
          : "Wait for service to resume because there is no alternative route to compare.";
      }
      return ja
        ? `${be}を過ぎると${target}のほうが早く着きます。`
        : `After ${be}, ${target} gets you there sooner.`;
    case "no_alternative":
      return buildNoAlternativeSentence(input.language);
    case "break_even_passed":
      if (!be) {
        return ja
          ? `分岐点を過ぎています。いま再開しても${target}のほうが早く着きます。`
          : `The decision point has passed. Take ${target} to arrive sooner even if service resumes now.`;
      }
      return ja
        ? `分岐点${be}を過ぎています。いま再開しても${target}のほうが早く着きます。`
        : `The ${be} decision point has passed. Take ${target} to arrive sooner even if service resumes now.`;
    case "rain_continuing":
      return ja
        ? "雨で代わりの路線も止まるおそれがあります。"
        : "Alternative routes may stop in this rain.";
    case "low_confidence":
      if (!be) {
        return ja
          ? "待つ場合と比べられる代わりの経路がないため運転再開を待ちます。"
          : "Wait for service to resume because there is no alternative route to compare.";
      }
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると${target}のほうが早く着きます。再開見込みには幅があります。`
          : `The outlook is still wide. After ${be}, ${target} gets you there sooner.`;
      }
      return ja
        ? `${be}を過ぎると${target}のほうが早く着きます。再開見込みは${p50}〜${p80}頃です。`
        : `Resumption is expected between ${p50} and ${p80}. After ${be}, ${target} gets you there sooner.`;
    case "estimate_extended":
      if (!p80 || !be) {
        return ja
          ? "再開見込みは延長後もさらに延びるおそれがあります。"
          : "The resumption estimate was extended and may slip further.";
      }
      return ja
        ? `延長後の遅めの再開見込み${p80}頃は分岐点${be}より後です。`
        : `The extended outlook of ${p80} is past the decision point of ${be}.`;
    case "resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? "再開見込みが分岐点より遅いためです。"
          : "Resumption is expected after the break-even time.";
      }
      return ja
        ? `再開見込み${p50}頃は分岐点${be}より後です。`
        : `Expected restart ${p50} is after the decision point of ${be}.`;
    case "resume_mostly_after_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      if (!p50 || !p80 || !be || minutes === null) {
        return ja
          ? "再開見込みの大半は目前の分岐点より後です。"
          : "Most of the restart outlook is after the approaching decision point.";
      }
      return ja
        ? `再開見込み${p50}〜${p80}頃の大半は分岐点${be}より後です。分岐点まであと${minutes}分です。`
        : `Most of the ${p50}–${p80} outlook falls after the ${be} decision point. Only ${minutes} min remain.`;
    }
    case "deadline_risk":
      if (!deadline) {
        return ja
          ? `待つと期限に間に合いません。${target}なら間に合います。`
          : `Waiting misses your deadline. Take ${target} to make it.`;
      }
      return ja
        ? `待つと期限の${deadline}に間に合いません。${target}なら間に合います。`
        : `Waiting misses your ${deadline} deadline. Take ${target} to make it.`;
    case "resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja
          ? "待つほうが早く着く見込みです。"
          : "Waiting is expected to get you there sooner.";
      }
      // 分岐点をわずかに過ぎる見込みでも、乗り換えの手間を考えて待つ場合がある
      if (input.marginP50Minutes < 0) {
        return ja
          ? `再開見込み${p50}頃と分岐点${be}の差はわずかです。乗り換えるほどの差はありません。`
          : `Expected restart ${p50} is close to the ${be} decision point. Stay to avoid an unnecessary change.`;
      }
      return ja
        ? `再開見込み${p50}頃は分岐点${be}より前です。`
        : `Expected restart ${p50} is before the decision point of ${be}.`;
    // 発表の時刻をもとにした推定であることが分かるよう、発表の見込みと「見込みどおりなら」を書く
    case "stated_resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? `発表の再開見込みは分岐点より後です。見込みどおりでも${target}のほうが早く着きます。`
          : `The announced restart is after the decision point. Take ${target} to arrive sooner even if it holds.`;
      }
      return ja
        ? `発表の再開見込み${p50}は分岐点${be}より後です。見込みどおりでも${target}のほうが早く着きます。`
        : `Announced restart ${p50} is after the ${be} decision point. Take ${target} to arrive sooner even if it holds.`;
    case "stated_resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja
          ? "発表の再開見込みどおりなら待つほうが早く着きます。"
          : "If the announced restart holds, waiting gets you there sooner.";
      }
      if (input.marginP50Minutes < 0) {
        return ja
          ? `発表の再開見込み${p50}と分岐点${be}の差はわずかです。乗り換えるほどの差はありません。`
          : `Announced restart ${p50} is close to the ${be} decision point. Stay to avoid an unnecessary change.`;
      }
      return ja
        ? `発表の再開見込み${p50}は分岐点${be}より前です。見込みどおりなら待つほうが早く着きます。`
        : `Announced restart ${p50} is before the ${be} decision point. Wait to arrive sooner if it holds.`;
  }
}

// 切り替えになる理由
const SWITCH_REASONS: ReadonlySet<DecisionReason> = new Set([
  "break_even_passed",
  "estimate_extended",
  "resume_after_break_even",
  "resume_mostly_after_break_even",
  "deadline_risk",
  "stated_resume_after_break_even",
]);

// 見出しは 3 つの形のどれかにする。待つ、切り替える、いまは待ちつつ分岐点を過ぎたら切り替える
// 情報が足りなくても「判断できない」とは書かず、いまの最善の一手を言い切る
function buildDecisionHeadline(input: DecisionTextInput): string {
  const ja = input.language === "ja";
  const target = nameSwitchTarget(input.bestOption, input.language);
  const switchHeadline = ja ? `いま${target}に切り替える` : `Switch to ${target} now.`;
  // 短く終わり見込みの立てやすい事象では、待つ見出しを安心させる言い方にする
  const waitHeadline =
    input.flow?.outlook === "short"
      ? ja
        ? "このまま待つ"
        : "Stay and wait."
      : ja
        ? "運転再開を待つ"
        : "Wait for service to resume.";
  const be = input.breakEvenTime ? formatClock(input.breakEvenTime, input.language) : null;
  const holdHeadline = be
    ? ja
      ? `${be}までに動かなければ切り替える`
      : `Wait until ${be}. Switch if still stopped.`
    : waitHeadline;
  // 駅間の車内では、時刻まで待つ・あと何分の形は実行できない。次の駅に着いてからの行動にする
  if (input.trainQueue) {
    const action = SWITCH_REASONS.has(input.reason) ? "switch" : "wait";
    return buildTrainQueueHeadline(input.trainQueue, action, target, input.language);
  }
  switch (input.reason) {
    case "unknown_event":
    case "low_confidence":
      return holdHeadline;
    case "no_alternative":
      return waitHeadline;
    case "rain_continuing":
      return ja ? "雨が弱まるまで待つ" : "Wait until the rain eases.";
    case "break_even_passed":
    case "estimate_extended":
    case "resume_after_break_even":
    case "resume_mostly_after_break_even":
    case "deadline_risk":
    case "stated_resume_after_break_even":
      return switchHeadline;
    case "resume_before_break_even":
    case "stated_resume_before_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      if (input.flow?.outlook === "short") return waitHeadline;
      if (minutes === null || minutes <= 0) return waitHeadline;
      return ja ? `あと${minutes}分は待つ` : `Wait up to ${minutes} more minutes.`;
    }
  }
}

// 流れの一文に続ける比較。流れの一文が見込みを言うので、比較は短くする
function buildFlowFollowUp(input: DecisionTextInput, outlook: FlowOutlook): string {
  const ja = input.language === "ja";
  const be = input.breakEvenTime ? formatClock(input.breakEvenTime, input.language) : null;
  const target = nameSwitchTarget(input.bestOption, input.language);
  if (outlook === "short" && input.reason === "resume_before_break_even") {
    return ja ? "このまま待つほうが早く着きます。" : "Staying put gets you there sooner.";
  }
  if ((input.reason === "low_confidence" || input.reason === "unknown_event") && be) {
    return ja
      ? `${be}を過ぎると${target}のほうが早く着きます。`
      : `After ${be}, ${target} gets you there sooner.`;
  }
  return buildDecisionReason(input);
}

// 見込みが立てやすい事象では、理由の頭に流れの一文を置き、確率があれば最後に 1 文で添える
// 駅間の車内では、次の駅に着く見込みの一文を頭に置く。上限を超えるなら短い形にし、それでも超えれば外す
// 駅間の一文は確率の一文より先に残し、確率の一文は流れの一文より先に残す
function composeReason(input: DecisionTextInput): string {
  const base = buildDecisionReason(input);
  const flow = input.flow;
  const max = reasonLimits[input.language].max;
  const glue = input.language === "ja" ? "" : " ";
  const withFlow = flow?.inReason
    ? `${flow.sentence}${glue}${buildFlowFollowUp(input, flow.outlook)}`
    : null;
  const chance = input.chance ? buildChanceSentence(input.chance, input.language) : null;
  const withChance = (text: string | null): string | null =>
    text !== null && chance !== null ? `${text}${glue}${chance}` : null;
  const present = (texts: (string | null)[]): string[] =>
    texts.filter((text): text is string => text !== null);
  const queue = input.trainQueue;
  if (queue) {
    const note = buildTrainQueueNote(queue, input.language);
    const short = buildShortTrainQueueNote(queue, input.language);
    const bodies = present([
      note && withFlow ? `${note}${glue}${withFlow}` : null,
      note ? `${note}${glue}${base}` : null,
      short ? `${short}${glue}${base}` : null,
      withFlow,
      base,
    ]);
    // 各段で確率を添えた形を先に試し、収まらなければ確率だけを外して次の段へ進む
    return pickFitting(
      bodies.flatMap((body) => present([withChance(body), body])),
      max,
    );
  }
  const candidates = present([withChance(withFlow), withChance(base), withFlow]);
  return candidates.find((text) => [...text].length <= max) ?? base;
}

// 決定論モードの見出しと理由
export function buildDecisionText(input: DecisionTextInput): DecisionText {
  return { headline: buildDecisionHeadline(input), reason: composeReason(input) };
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

const TREND_PHRASES: Record<WeatherTrend, { ja: string; en: string } | null> = {
  rising: { ja: "強まっています", en: "increasing" },
  falling: { ja: "弱まっています", en: "easing" },
  steady: { ja: "横ばいです", en: "holding steady" },
  unknown: null,
};

// weather_checked の要約。「直近の10分雨量は5mmで、弱まっています。大雨警報が出ています。」
export function buildWeatherSummary(input: {
  latestMm: number | null;
  trend: WeatherTrend;
  warnings: readonly string[];
  language: Lang;
}): string {
  const { latestMm, trend, warnings, language } = input;
  const ja = language === "ja";
  const phrase = TREND_PHRASES[trend]?.[language] ?? null;
  const rain =
    latestMm === null
      ? ja
        ? "直近の10分雨量は欠測です。"
        : "The latest 10-min rainfall is missing."
      : ja
        ? `直近の10分雨量は${latestMm}mm${phrase ? `で、${phrase}` : "です"}。`
        : `Latest 10-min rainfall: ${latestMm} mm${phrase ? `, ${phrase}` : ""}.`;
  if (warnings.length === 0) return rain;
  if (ja) return `${rain}${warnings.join("・")}が出ています。`;
  const hasWarning = warnings.some((w) => w.includes("警報"));
  return `${rain} ${hasWarning ? "A weather warning is in effect." : "A weather advisory is in effect."}`;
}
