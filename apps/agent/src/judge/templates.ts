import { type ConcreteTrainType, getJstMinuteOfDay, type TrainQueueDelay } from "@repo/core";
import type {
  AnnouncementCueId,
  Lang,
  ProgressStage,
  RouteOption,
  WeatherTrend,
} from "@repo/schema";
import { headlineLimits, reasonLimits } from "../config.ts";

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
    ? "推定であり、公式発表を優先してください。"
    : "Estimate only. Follow official notices.";
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

// 境目は再開の条件と比較先の到着を一文で示す
export function buildBreakEvenSentence(
  time: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}より待つほうが早く着きます。`
    : `If service restarts by ${formatClock(time, language)}, waiting is at least as fast as ${route} arriving at ${formatClock(arrival, language)}.`;
}

export function buildPassedSentence(
  time: string,
  label: string,
  arrival: string,
  language: Lang,
): string {
  const route = formatLabelInSentence(label, language);
  return language === "ja"
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}より待つほうが早く着けました。`
    : `If service had restarted by ${formatClock(time, language)}, waiting would have been at least as fast as ${route} arriving at ${formatClock(arrival, language)}.`;
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
    ? `${formatClock(time, language)}までに再開すれば${formatClock(arrival, language)}着の${route}に切り替えなくても期限に間に合います。`
    : `If service restarts by ${formatClock(time, language)}, you meet your ${formatClock(deadline, language)} deadline without switching to ${route} arriving at ${formatClock(arrival, language)}.`;
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
    ? `${formatClock(time, language)}を過ぎたので${formatClock(deadline, language)}の期限に向けて${formatClock(arrival, language)}着の${route}に切り替えてください。`
    : `The ${formatClock(time, language)} cutoff has passed. Switch to ${route} arriving at ${formatClock(arrival, language)} to meet your ${formatClock(deadline, language)} deadline.`;
}

export function buildNoAlternativeSentence(language: Lang): string {
  return language === "ja"
    ? "待つ場合と到着時刻を比べられる代わりの手段がないので運転再開をこのまま待ってください。"
    : "No alternative is available to compare. Wait for service to restart.";
}

// 代わりの手段が無いときの理由。先頭の 1 文として短く言う
function buildNoAlternativeReason(language: Lang): string {
  return language === "ja" ? "代わりの手段がありません。" : "No alternative route is available.";
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
  | "stated_resume_before_break_even"
  // 再開しても先の列車が詰まって進みにくい。待つより切り替えるほうが確か
  | "queue_after_resume"
  // 線路に降りる案内が出た。係員の案内に従うことを第一にし、再開の時刻を見込まない
  | "follow_staff";

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
  // 判断で比較した境目の再開時刻。境目が無ければ null
  comparisonTime?: string | null;
  // 待って期限に間に合うための再開時刻。期限か待つ経路が無ければ null
  deadlineResumeTime?: string | null;
  // 待って期限に間に合う確率。期限が無ければ null
  waitOnTime: number | null;
  // 通常は5割に達する最初の目盛り、無ければ最後
  // laterOutlookなら境目後の8割以上の最初、無ければ境目後の最初
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
        ? `${time}までに動く見込みは${c}です。`
        : `The chance of a restart by ${time} is ${c}.`;
    }
    return ja
      ? `待つほうが早く着く見込みは${c}です。`
      : `The chance that waiting is faster is ${c}.`;
  }
  if (chance.waitOnTime !== null) {
    const c = formatChance(chance.waitOnTime, language);
    if (chance.deadlineResumeTime) {
      const time = formatClock(chance.deadlineResumeTime, language);
      return ja
        ? `${time}までに動けば期限に間に合います。その見込みは${c}です。`
        : `A restart by ${time} meets your deadline. The chance is ${c}.`;
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
        ? `遅めに見ると、${clock}までに動く見込みは${c}です。`
        : `Looking later, the chance of a restart by ${clock} is ${c}.`;
    }
    return ja
      ? `${clock}までに動く見込みは${c}です。`
      : `The chance of a restart by ${clock} is ${c}.`;
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
  // 勧める代替手段。legs があれば、見出しに乗る路線と駅を書く
  bestOption:
    | (Pick<RouteOption, "kind" | "label" | "isTransferService"> &
        Partial<Pick<RouteOption, "legs">>)
    | null;
  // 種類の規則表の、短く終わるか長くかかるかの区別。見出しの言い方だけに使う
  flow?: { outlook: "short" | "long" } | null;
  // 待ったほうが早く着く確率など。理由の最後に 1 文で添える。無ければ添えない
  chance?: ChanceTextInput | null;
};

export type TrainQueueText = {
  // ホームに着けて降りられる駅
  alightStation: string;
  arrivalP50: string | null;
  // 自分の列車が動き出す見込み。無ければ null
  departureP50: string | null;
  beforeResume: boolean;
  trainsAheadCount: number;
  // 前の列車を通常の間隔で先を走っていたとみなしたか。目の前に詰まっているとみなしたなら false
  spacedByHeadway: boolean;
  ownTrainType: ConcreteTrainType;
  delays: readonly TrainQueueDelay[];
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

// 駅間の車内の見出し。結論は車内で待つだけにし、2 文目で列車が動き出す時刻を伝える
// 詰める動きで再開の前に次の駅へ進めるときも、動き出す時刻を使う。着く時刻は理由に書く
function buildInCarHeadline(queue: TrainQueueText | null, language: Lang): string {
  const ja = language === "ja";
  const lead = ja ? "車内で待つ" : "Stay on board.";
  if (!queue?.departureP50) return lead;
  const time = formatClock(queue.departureP50, language);
  const full = ja
    ? `${lead}。動くのは${time}ごろの見込み`
    : `${lead} Expected to move around ${time}.`;
  return pickFitting([full, lead], headlineLimits[language].max);
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
      : `Expect to reach ${st} around ${time} after service restarts. The ${type} ahead cannot stop at ${delay.station} and is held short of it.`;
  }
  if (delay?.kind === "platform_occupied") {
    const type = formatTrainType(delay.occupiedBy, language);
    return ja
      ? `${st}には再開後の${time}ごろに着く見込みです。${delay.station}のホームに前の${type}が止まっています。`
      : `Expect to reach ${st} around ${time} after service restarts. A ${type} ahead occupies the platform at ${delay.station}.`;
  }
  if (delay?.kind === "own_cannot_stop") {
    return ja
      ? `降りられる${st}には${time}ごろに着く見込みです。${own}は${delay.station}に止まれません。`
      : `Expect your first stop at ${st} around ${time}. Your ${own} cannot stop at ${delay.station}.`;
  }
  // 前の列車の間隔の仮定と、前に列車がいないことは車内の前提のチップが示すので、文には書かない
  const n = queue.trainsAheadCount;
  if (queue.beforeResume) {
    if (n === 0 || queue.spacedByHeadway) {
      return ja
        ? `${st}には${time}ごろに着く見込みです。`
        : `Expect to reach ${st} around ${time}.`;
    }
    return ja
      ? `前の列車が順に進めば、${st}には${time}ごろに着く見込みです。`
      : `Expect to reach ${st} around ${time} if trains ahead move up.`;
  }
  if (n === 0 || queue.spacedByHeadway) {
    return ja
      ? `${st}には再開後の${time}ごろに着く見込みです。`
      : `Expect to reach ${st} around ${time} after service restarts.`;
  }
  return ja
    ? `${st}には${time}ごろに着く見込みです。前に${n}本詰まっています。`
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
// 待つ見出しは「20時05分まで待つ。動かなければ阪急京都線へ」の 2 文にし、画面は 2 文目を次の手として小さく出す
export type DecisionText = {
  headline: string;
  reason: string;
};

// 切り替え先の乗り方。最初に乗る路線と駅、その駅までの徒歩
type SwitchTarget = {
  kind: RouteOption["kind"] | null;
  line: string | null;
  station: string | null;
  walkMinutes: number;
  transferService: boolean;
};

function describeSwitchTarget(option: DecisionTextInput["bestOption"]): SwitchTarget {
  const legs = option?.legs ?? [];
  const rideIndex = legs.findIndex((leg) => leg.mode === "ride");
  const ride = legs[rideIndex];
  const walkMinutes = legs
    .slice(0, Math.max(0, rideIndex))
    .filter((leg) => leg.mode === "walk")
    .reduce((sum, leg) => sum + leg.minutes, 0);
  return {
    kind: option?.kind ?? null,
    line: option?.kind === "transfer" ? ride?.line || null : null,
    station: option?.kind === "transfer" ? ride?.from || null : null,
    walkMinutes,
    transferService: option?.isTransferService ?? false,
  };
}

// 切り替え先の呼び名。路線、乗る駅、振替輸送、手段の種類の順に、分かるもので呼ぶ
function nameSwitchTarget(option: DecisionTextInput["bestOption"], language: Lang): string {
  const ja = language === "ja";
  const target = describeSwitchTarget(option);
  if (target.kind === "taxi") return ja ? "タクシー" : "a taxi";
  if (target.kind === "walk") return ja ? "徒歩" : "walking";
  if (target.line) return ja ? target.line : `the ${target.line}`;
  if (target.station)
    return ja ? `${target.station}からの電車` : `the train from ${target.station}`;
  if (target.transferService) return ja ? "振替輸送" : "the transfer service";
  if (target.kind === "transfer") return ja ? "乗り換え" : "changing trains";
  return ja ? "代わりの手段" : "another way there";
}

// 期限が理由でタクシーを勧めるときの理由。境目は、待っても期限に間に合う最後の再開の時刻なので、
// 「境目を過ぎるとタクシーのほうが早く着く」ではなく、待っては期限に間に合わないと書く。当てはまらない理由は null
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
        ? `${be}を過ぎると、待っても${limit}の期限に間に合いません。`
        : `After ${be}, waiting misses your ${limit} deadline.`;
    case "low_confidence":
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると、待っても${limit}の期限に間に合いません。再開の見込みには幅があります。`
          : `After ${be}, waiting misses your ${limit} deadline. The restart outlook is still wide.`;
      }
      return ja
        ? `${be}を過ぎると、待っても${limit}の期限に間に合いません。再開の見込みは${p50}〜${p80}ごろです。`
        : `After ${be}, waiting misses your ${limit} deadline. Restart is likely ${p50}–${p80}.`;
    case "break_even_passed":
      return ja
        ? `いま動いても${limit}の期限に間に合いません。`
        : `Even a restart now misses your ${limit} deadline.`;
    case "stated_resume_after_break_even":
      if (!p50) return null;
      return ja
        ? `発表どおり${p50}に再開しても、${limit}の期限に間に合いません。`
        : `Even a restart at the announced ${p50} misses your ${limit} deadline.`;
    case "stated_resume_before_break_even":
      if (!p50 || (input.marginP50Minutes ?? 0) < 0) return null;
      return ja
        ? `発表どおり${p50}に再開すれば、${limit}の期限に間に合います。`
        : `A restart at the announced ${p50} meets your ${limit} deadline.`;
    default:
      return null;
  }
}

// 決定論モードの理由。先頭の 1 文は 25 字前後で、なぜその行動かを言う。画面はこの 1 文を見出しの下に出す
// 2 文目からは比較の詳しい形にし、開いたシートに出す
function buildDecisionReason(input: DecisionTextInput): string {
  if (input.reason === "follow_staff") {
    return input.language === "ja"
      ? "線路に降りる案内が出ています。再開の時刻は見込めません。"
      : "Passengers are being guided off the train. The restart time cannot be estimated.";
  }
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
    // 保留のときも謝らず、境目を過ぎたら何が早いかを比べる形で書く。次に確かめることは画面が別に示す
    case "unknown_event":
      if (!be) return buildNoAlternativeReason(input.language);
      return ja
        ? `${be}を過ぎると${target}のほうが早く着きます。`
        : `After ${be}, ${target} gets you there sooner.`;
    case "no_alternative":
      return buildNoAlternativeReason(input.language);
    case "break_even_passed":
      return ja
        ? `いま動いても${target}のほうが早く着きます。`
        : `Even a restart now is slower than ${target}.`;
    case "rain_continuing":
      return ja
        ? "雨で代わりの路線も止まるおそれがあります。"
        : "Alternative routes may also stop in this rain.";
    case "low_confidence":
      if (!be) return buildNoAlternativeReason(input.language);
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると${target}のほうが早く着きます。再開の見込みには幅があります。`
          : `After ${be}, ${target} gets you there sooner. The restart outlook is still wide.`;
      }
      return ja
        ? `${be}を過ぎると${target}のほうが早く着きます。再開の見込みは${p50}〜${p80}ごろです。`
        : `After ${be}, ${target} gets you there sooner. Restart is likely ${p50}–${p80}.`;
    // 切り替える理由は、先頭の 1 文で待つ場合と比べ、2 文目で再開の見込みの時刻を添える
    case "estimate_extended":
      if (!p80 || !be) {
        return ja
          ? "延長後の見込みも、さらに延びるおそれがあります。"
          : "The extended outlook may slip further.";
      }
      return ja
        ? `延長後も${target}のほうが早く着きます。再開は${p80}ごろの見込みです。`
        : `Even after the extension, ${target} is faster. Restart is expected around ${p80}.`;
    case "resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? `待つより${target}のほうが早く着く見込みです。`
          : `${capitalize(target)} should be faster than waiting.`;
      }
      return ja
        ? `待つより${target}のほうが早く着きます。再開は${p50}ごろの見込みです。`
        : `${capitalize(target)} is faster than waiting. Restart is expected around ${p50}.`;
    case "resume_mostly_after_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      if (!p50 || !p80 || !be || minutes === null) {
        return ja
          ? `待つより${target}のほうが早く着く見込みです。`
          : `${capitalize(target)} should be faster than waiting.`;
      }
      return ja
        ? `待つより${target}のほうが早く着く見込みです。再開の見込みは${p50}〜${p80}ごろです。`
        : `${capitalize(target)} should be faster than waiting. Restart is likely ${p50}–${p80}.`;
    }
    case "deadline_risk":
      if (!deadline) {
        return ja
          ? `待つと期限に間に合いません。${target}なら間に合います。`
          : `Waiting misses your deadline. ${capitalize(target)} makes it.`;
      }
      return ja
        ? `待つと期限の${deadline}に間に合いません。${target}なら間に合います。`
        : `Waiting misses your ${deadline} deadline. ${capitalize(target)} makes it.`;
    case "resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja ? "待つほうが早く着く見込みです。" : "Waiting should get you there sooner.";
      }
      // 境目をわずかに過ぎる見込みでも、乗り換えの手間を考えて待つ場合がある
      if (input.marginP50Minutes < 0) {
        return ja
          ? `乗り換えても大きな差はありません。再開は${p50}ごろの見込みです。`
          : `Changing trains gains little. Restart is expected around ${p50}.`;
      }
      return ja
        ? `待つほうが早く着きます。再開は${p50}ごろの見込みです。`
        : `Waiting gets you there sooner. Restart is expected around ${p50}.`;
    // 発表の時刻をもとにした推定であることが分かるよう、発表の見込みと「見込みどおりなら」を書く
    case "stated_resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? `発表どおりに再開しても、${target}のほうが早く着きます。`
          : `Even at the announced restart, ${target} is faster.`;
      }
      return ja
        ? `発表どおり${p50}に再開しても、${target}のほうが早く着きます。`
        : `Even at the announced ${p50} restart, ${target} is faster.`;
    case "stated_resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja
          ? "発表どおりに再開すれば、待つほうが早く着きます。"
          : "If the announced restart holds, waiting is faster.";
      }
      if (input.marginP50Minutes < 0) {
        return ja
          ? `発表どおり${p50}に再開すれば、乗り換えても大きな差はありません。`
          : `If the announced ${p50} restart holds, changing trains gains little.`;
      }
      return ja
        ? `発表どおり${p50}に再開すれば、待つほうが早く着きます。`
        : `If the announced ${p50} restart holds, waiting is faster.`;
    case "queue_after_resume":
      return ja
        ? `再開しても前の列車が詰まって進みにくい見込みです。${target}のほうが確かです。`
        : `Even after a restart, trains ahead are backed up. ${capitalize(target)} is more reliable.`;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// 切り替えの見出し。どの路線に、どこから乗るかを言い切る。上限に収まる最初の形を使う
function buildSwitchHeadline(input: DecisionTextInput): string {
  const ja = input.language === "ja";
  const max = headlineLimits[input.language].max;
  const target = describeSwitchTarget(input.bestOption);
  if (target.kind === "taxi") return ja ? "タクシーに乗る" : "Take a taxi.";
  if (target.kind === "walk") return ja ? "歩いて向かう" : "Walk there.";
  const { line, station } = target;
  if (line) {
    const walkTo =
      station && target.walkMinutes > 0
        ? ja
          ? `${station}まで歩いて${line}へ`
          : `Walk to ${station} for the ${line}.`
        : null;
    const change = target.transferService
      ? ja
        ? `振替で${line}に乗る`
        : `Take the ${line} on the transfer service.`
      : ja
        ? `${line}に乗り換える`
        : `Change to the ${line}.`;
    return pickFitting(
      [walkTo, change, ja ? `${line}に乗り換える` : `Change to the ${line}.`].filter(
        (text): text is string => text !== null,
      ),
      max,
    );
  }
  // 路線が分からないときは、乗る駅、振替輸送、手段の種類の順に、分かるもので言い切る
  if (station) {
    return target.walkMinutes > 0
      ? ja
        ? `${station}まで歩いて乗り換える`
        : `Walk to ${station} and change trains.`
      : ja
        ? `${station}で乗り換える`
        : `Change trains at ${station}.`;
  }
  if (target.transferService) return ja ? "振替輸送で向かう" : "Use the transfer service.";
  if (target.kind === "transfer") return ja ? "電車を乗り換える" : "Change trains.";
  return ja ? "代わりの手段で向かう" : "Take another way there.";
}

// 動かなかったときの次の手。待つ見出しの 2 文目に置く
function buildFallbackStep(input: DecisionTextInput): string | null {
  if (!input.bestOption) return null;
  const ja = input.language === "ja";
  const target = describeSwitchTarget(input.bestOption);
  if (target.kind === "taxi")
    return ja ? "動かなければタクシーへ" : "If still stopped, take a taxi.";
  if (target.kind === "walk")
    return ja ? "動かなければ歩いて向かう" : "If still stopped, walk there.";
  if (target.line) {
    return ja ? `動かなければ${target.line}へ` : `If still stopped, take the ${target.line}.`;
  }
  // 路線が分からないときは、乗る駅、振替輸送、手段の種類の順に、分かるもので言い切る
  if (target.station) {
    return ja ? `動かなければ${target.station}へ` : `If still stopped, go to ${target.station}.`;
  }
  if (target.transferService) {
    return ja ? "動かなければ振替輸送へ" : "If still stopped, use the transfer service.";
  }
  return ja ? "動かなければ電車を乗り換える" : "If still stopped, change trains.";
}

// 待つ見出し。境目の時刻まで待つと言い切り、動かなければ何に乗るかを添える
function buildWaitUntilHeadline(input: DecisionTextInput, plain: string): string {
  const ja = input.language === "ja";
  const be = input.breakEvenTime ? formatClock(input.breakEvenTime, input.language) : null;
  const lead = be ? (ja ? `${be}まで待つ` : `Wait until ${be}.`) : plain;
  const fallback = be ? buildFallbackStep(input) : null;
  if (!fallback) return lead;
  const full = ja ? `${lead}。${fallback}` : `${lead} ${fallback}`;
  return [...full].length <= headlineLimits[input.language].max ? full : lead;
}

// 見出しは 3 つの形のどれかにする。待つ、切り替える、境目の時刻まで待ち動かなければ切り替える
// 情報が足りなくても「判断できない」とは書かず、いまの最善の一手を言い切る
function buildDecisionHeadline(input: DecisionTextInput): string {
  const ja = input.language === "ja";
  // 短く終わり見込みの立てやすい事象では、待つ見出しを安心させる言い方にする
  const waitHeadline =
    input.flow?.outlook === "short"
      ? ja
        ? "このまま待つ"
        : "Stay and wait."
      : ja
        ? "運転再開を待つ"
        : "Wait for service to restart.";
  switch (input.reason) {
    case "unknown_event":
    case "low_confidence":
      return buildWaitUntilHeadline(input, waitHeadline);
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
    case "queue_after_resume":
      return buildSwitchHeadline(input);
    case "follow_staff":
      return ja ? "係員の案内に従う" : "Follow the staff's instructions.";
    case "resume_before_break_even":
    case "stated_resume_before_break_even": {
      if (input.flow?.outlook === "short") return waitHeadline;
      const minutes = input.breakEvenMinutesFromNow;
      if (minutes === null || minutes <= 0) return waitHeadline;
      return buildWaitUntilHeadline(input, waitHeadline);
    }
  }
}

// 理由に確率の一文を添える。上限を超えるなら比較の文だけにする
// 再開までの分を事象の決まった流れとして言い切る文は置かない。見込みは画面の図で幅を持たせて示す
function composeReason(input: DecisionTextInput): string {
  const base = buildDecisionReason(input);
  const max = reasonLimits[input.language].max;
  const glue = input.language === "ja" ? "" : " ";
  const chance = input.chance ? buildChanceSentence(input.chance, input.language) : null;
  const withChance = chance !== null ? `${base}${glue}${chance}` : null;
  return withChance !== null && [...withChance].length <= max ? withChance : base;
}

// 決定論モードの見出しと理由
export function buildDecisionText(input: DecisionTextInput): DecisionText {
  return { headline: buildDecisionHeadline(input), reason: composeReason(input) };
}

// 駅間の車内の理由の最後の手。着く見込みが無いとき
function buildInCarFallbackReason(language: Lang): string {
  return language === "ja"
    ? "列車が動くまで、車内で待ってください。"
    : "Stay on board until the train moves.";
}

export type InCarTextInput = {
  language: Lang;
  // 次の駅が分からなければ null。見出しは「車内で待つ」だけにする
  queue: TrainQueueText | null;
  // 再開後に先の列車が詰まり、次の駅で降りて乗り換える価値があるか
  worthAlighting?: boolean;
};

// 次の駅で降りて乗り換える価値があるときの一文。降りる駅が分からなければ次の駅と言う
function buildAlightWorthNote(queue: TrainQueueText | null, language: Lang): string {
  const station = queue?.alightStation ?? null;
  if (language === "ja") {
    return station
      ? `先の列車が詰まっています。${station}で降りて乗り換える手があります。`
      : "先の列車が詰まっています。次の駅で降りて乗り換える手があります。";
  }
  return station
    ? `Trains ahead are backed up. You can get off at ${station} and change.`
    : "Trains ahead are backed up. You can get off at the next station and change.";
}

// 駅間の車内の見出しと理由。切り替えの比較は書かず、次の駅に着く見込みだけを書く
// 理由は上限に収まる最初の形にする
export function buildInCarDecisionText(input: InCarTextInput): DecisionText {
  const { language, queue } = input;
  const note = queue ? buildTrainQueueNote(queue, language) : null;
  const short = queue ? buildShortTrainQueueNote(queue, language) : null;
  const glue = language === "ja" ? "" : " ";
  // 詰まりで降りる価値があれば、着く見込みの後にその一文を添える
  const alight = input.worthAlighting ? buildAlightWorthNote(queue, language) : null;
  const withAlight = (text: string | null) => (alight && text ? `${text}${glue}${alight}` : null);
  const candidates = [
    withAlight(short),
    alight,
    note,
    short,
    buildInCarFallbackReason(language),
  ].filter((text): text is string => text !== null);
  return {
    headline: buildInCarHeadline(queue, language),
    reason: pickFitting(candidates, reasonLimits[language].max),
  };
}

// 着いた後の次の一手の一文。「福島に着いたら阪神本線へ」。乗る駅が別なら「十三まで歩いて」を挟む
export function buildAfterAlightText(
  alightStation: string,
  step: {
    kind: "transfer" | "taxi" | "walk";
    line: string | null;
    boardStation: string | null;
  },
  language: Lang,
): string {
  const ja = language === "ja";
  const st = alightStation;
  if (step.kind === "taxi") return ja ? `${st}に着いたらタクシーへ` : `At ${st}, take a taxi.`;
  if (step.kind === "walk") return ja ? `${st}に着いたら歩いて向かう` : `At ${st}, walk there.`;
  if (!step.line) return ja ? `${st}に着いたら乗り換える` : `At ${st}, change trains.`;
  const board = step.boardStation && step.boardStation !== st ? step.boardStation : null;
  if (board) {
    return ja
      ? `${st}に着いたら${board}まで歩いて${step.line}へ`
      : `At ${st}, walk to ${board} for the ${step.line}.`;
  }
  return ja ? `${st}に着いたら${step.line}へ` : `At ${st}, change to the ${step.line}.`;
}

const PROGRESS_MESSAGES: Record<ProgressStage, { ja: string; en: string }> = {
  interpret: { ja: "掲示や発表を読み取っています", en: "Reading the announcement" },
  weather: { ja: "雨量と警報を確かめています", en: "Checking rainfall and warnings" },
  phase: {
    ja: "再開までの見込みを見積もっています",
    en: "Estimating when service will restart",
  },
  alternatives: { ja: "代わりの手段を探しています", en: "Searching for alternative routes" },
  break_even: { ja: "境目の時刻を計算しています", en: "Computing the cutoff time" },
  judgment: { ja: "判断をまとめています", en: "Putting the advice together" },
};

// 各段階の開始を知らせる短文
export function buildProgressMessage(stage: ProgressStage, language: Lang): string {
  return PROGRESS_MESSAGES[stage][language];
}

const TREND_PHRASES: Record<WeatherTrend, { ja: string; en: string } | null> = {
  rising: { ja: "雨は強まっています。", en: "Rain is increasing." },
  falling: { ja: "雨は弱まっています。", en: "Rain is easing." },
  steady: { ja: "雨は横ばいです。", en: "Rain is holding steady." },
  unknown: null,
};

// weather_checked の要約。「直近の10分雨量は5mmです。雨は弱まっています。大雨警報が出ています。」
export function buildWeatherSummary(input: {
  latestMm: number | null;
  trend: WeatherTrend;
  warnings: readonly string[];
  language: Lang;
}): string {
  const { latestMm, trend, warnings, language } = input;
  const ja = language === "ja";
  const phrase = TREND_PHRASES[trend]?.[language] ?? null;
  const amount =
    latestMm === null
      ? ja
        ? "直近の10分雨量は届いていません。"
        : "The latest 10-min rainfall is not available."
      : ja
        ? `直近の10分雨量は${latestMm}mmです。`
        : `The latest 10-min rainfall is ${latestMm} mm.`;
  const glue = ja ? "" : " ";
  const rain = phrase ? `${amount}${glue}${phrase}` : amount;
  if (warnings.length === 0) return rain;
  if (ja) return `${rain}${warnings.join("・")}が出ています。`;
  const hasWarning = warnings.some((w) => w.includes("警報"));
  return `${rain} ${hasWarning ? "A weather warning is in effect." : "A weather advisory is in effect."}`;
}

// 根拠の説明。発表の引用は利用者が持ち込んだ文をそのまま添える

// 起きていることの呼び名を含む発表の引用
export function buildSignalEvidence(quote: string, language: Lang): string {
  return language === "ja" ? `発表に「${quote}」とあります。` : `The notice says: "${quote}".`;
}

const CUE_MEANINGS: Record<AnnouncementCueId, { ja: string; en: string }> = {
  resumed: { ja: "運転は再開しています。", en: "Service has restarted." },
  resume_soon: { ja: "再開が近いとみられます。", en: "A restart looks close." },
  rescue: { ja: "救援を待つので長引くとみられます。", en: "Waiting for rescue may take long." },
  protection_received: {
    ja: "周りの同じ会社の列車もそろって止まっているとみられます。",
    en: "Other trains of the same company have likely stopped too.",
  },
  queue_ahead: { ja: "前の列車が詰まっています。", en: "Trains ahead are backed up." },
  track_cleared: {
    ja: "線路の安全が確かめられたとみられます。",
    en: "The track looks confirmed safe.",
  },
  evacuation_on_track: {
    ja: "係員の案内に従ってください。",
    en: "Follow the staff's instructions.",
  },
  turnback: {
    ja: "止まった区間の外は動いているとみられます。",
    en: "Trains outside the stopped section look to be running.",
  },
  service_cancelled: {
    ja: "この列車はこの先へ進まないとみられます。",
    en: "This train looks set to go no further.",
  },
  through_service_suspended: {
    ja: "乗り入れ先へは乗り換えが要るとみられます。",
    en: "You will likely need to change trains at the connecting station.",
  },
  slow_running: {
    ja: "動いても遅れが出るとみられます。",
    en: "Trains may run late even once moving.",
  },
  held_at_station: {
    ja: "駅に止まっているので、降りてほかの手段に移れます。",
    en: "The train is at a station, so you can get off and switch.",
  },
  inspection_ongoing: {
    ja: "点検が終わるまでは動かないとみられます。",
    en: "Trains likely stay stopped until the check is done.",
  },
  proceed_to_station: {
    ja: "次の駅まで進む見込みです。",
    en: "The train looks set to move on to the next station.",
  },
};

// 放送の手がかり。引用が無いとき（選んで答えたとき）は意味だけを書く
export function buildCueEvidence(cue: AnnouncementCueId, quote: string, language: Lang): string {
  const meaning = CUE_MEANINGS[cue][language];
  if (quote.trim().length === 0) return meaning;
  return language === "ja" ? `「${quote}」とあり、${meaning}` : `"${quote}": ${meaning}`;
}

// 支障の無い線路が先に動く見込み
export function buildUnaffectedTrackEvidence(language: Lang): string {
  return language === "ja"
    ? "反対の線路は、安全が確かめられれば先に動き出すことがあります。"
    : "The opposite track may restart first once it is checked.";
}

// 再開後の詰まりの見込み
export function buildResumeQueueEvidence(worthAlighting: boolean, language: Lang): string {
  if (language === "ja") {
    return worthAlighting
      ? "再開しても前の列車が詰まって先へ進みにくい見込みです。"
      : "再開しても、前の列車が順に動くまで少し待つ見込みです。";
  }
  return worthAlighting
    ? "Even after a restart, trains ahead may hold you up."
    : "After a restart, expect a short wait while trains ahead move.";
}
