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

// 代わりの経路が無いときの理由。先頭の 1 文として短く言う
function buildNoAlternativeReason(language: Lang): string {
  return language === "ja"
    ? "代わりの経路がないので運転再開を待ちます。"
    : "No alternative route is available. Wait for service to resume.";
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
        ? `境目の${time}までに動く見込みは${c}です。`
        : `Chance of restart by the ${time} cutoff: ${c}.`;
    }
    return ja ? `待ったほうが早く着く見込みは${c}です。` : `Chance that waiting is faster: ${c}.`;
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
      : `Chance of making your deadline by waiting: ${c}.`;
  }
  if (chance.keyTick) {
    const c = formatChance(chance.keyTick.tenths, language);
    const clock = formatClock(chance.keyTick.time, language);
    if (chance.laterOutlook) {
      return ja
        ? `遅めに見ると境目より後の${clock}までに動く見込みは${c}です。`
        : `Later outlook: ${c} chance of restart by ${clock}, after the cutoff.`;
    }
    return ja ? `${clock}までに動く見込みは${c}です。` : `Chance of restart by ${clock}: ${c}.`;
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
  // 見込みが立てやすい事象のよくある流れ。inReason は理由の頭に流れの一文を置くか
  flow?: { outlook: FlowOutlook; sentence: string; inReason: boolean } | null;
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
  // 前の列車をふだんの間隔で先を走っていたとみなしたか。目の前に詰まっているとみなしたなら false
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

// 駅間の車内の見出し。結論は車内で待つだけにし、2 文目で動く時刻か次の駅に着く時刻を伝える
// 詰める動きで再開の前に次の駅に着けるなら着く時刻、そうでなければ動き出す時刻を使う
function buildInCarHeadline(queue: TrainQueueText, language: Lang): string {
  const ja = language === "ja";
  const lead = ja ? "車内で待つ" : "Stay on board.";
  const max = headlineLimits[language].max;
  const st = queue.alightStation;
  const candidates: string[] = [];
  if (queue.beforeResume && queue.arrivalP50) {
    const time = formatClock(queue.arrivalP50, language);
    candidates.push(
      ja ? `${lead}。${st}に着くのは${time}ごろ` : `${lead} Reach ${st} around ${time}.`,
    );
  } else if (queue.departureP50) {
    const time = formatClock(queue.departureP50, language);
    candidates.push(
      ja ? `${lead}。動くのは${time}ごろの見込み` : `${lead} Expected to move around ${time}.`,
    );
  }
  return pickFitting([...candidates, lead], max);
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
    line: option?.kind === "transfer" ? (ride?.line ?? null) : null,
    station: option?.kind === "transfer" ? (ride?.from ?? null) : null,
    walkMinutes,
    transferService: option?.isTransferService ?? false,
  };
}

// 切り替え先の呼び名。路線が分かれば路線名、無ければ手段の種類で呼ぶ
function nameSwitchTarget(option: DecisionTextInput["bestOption"], language: Lang): string {
  const ja = language === "ja";
  const target = describeSwitchTarget(option);
  if (target.kind === "taxi") return ja ? "タクシー" : "a taxi";
  if (target.kind === "walk") return ja ? "徒歩" : "walking";
  if (target.line) return ja ? target.line : `the ${target.line}`;
  if (target.transferService) return ja ? "振替" : "the transfer service";
  return ja ? "別の路線" : "another line";
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
        ? `${be}を過ぎると待っては期限の${limit}に間に合いません。`
        : `After ${be}, waiting misses your ${limit} deadline.`;
    case "low_confidence":
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると待っては期限の${limit}に間に合いません。再開見込みには幅があります。`
          : `After ${be}, waiting misses your ${limit} deadline. The outlook is still wide.`;
      }
      return ja
        ? `${be}を過ぎると待っては期限の${limit}に間に合いません。再開見込みは${p50}〜${p80}頃です。`
        : `After ${be}, waiting misses your ${limit} deadline. Restart is likely ${p50}–${p80}.`;
    case "break_even_passed":
      return ja
        ? `いま動いても期限の${limit}に間に合いません。境目の${be}を過ぎています。`
        : `Even a restart now misses your ${limit} deadline. The ${be} cutoff has passed.`;
    case "stated_resume_after_break_even":
      if (!p50) return null;
      return ja
        ? `発表の再開が${p50}なら期限に間に合いません。境目の${be}より後です。`
        : `The announced ${p50} restart misses your ${limit} deadline. It is after the ${be} cutoff.`;
    case "stated_resume_before_break_even":
      if (!p50 || (input.marginP50Minutes ?? 0) < 0) return null;
      return ja
        ? `発表の再開が${p50}なら期限に間に合います。境目の${be}より前です。`
        : `The announced ${p50} restart meets your ${limit} deadline. It is before the ${be} cutoff.`;
    default:
      return null;
  }
}

// 決定論モードの理由。先頭の 1 文は 25 字前後で、なぜその行動かを言う。画面はこの 1 文を見出しの下に出す
// 2 文目からは比較の詳しい形にし、開いたシートに出す
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
    // 保留のときも謝らず、境目を過ぎたら何が早いかを比べる形で書く。次に確かめることは画面が別に示す
    case "unknown_event":
      if (!be) return buildNoAlternativeReason(input.language);
      return ja
        ? `${be}を過ぎると${target}が早く着きます。`
        : `After ${be}, ${target} gets you there sooner.`;
    case "no_alternative":
      return buildNoAlternativeReason(input.language);
    case "break_even_passed":
      if (!be) {
        return ja
          ? `いま動いても${target}が早く着きます。`
          : `Even a restart now is slower than ${target}.`;
      }
      return ja
        ? `いま動いても${target}が早く着きます。境目の${be}を過ぎています。`
        : `Even a restart now is slower than ${target}. The ${be} cutoff has passed.`;
    case "rain_continuing":
      return ja
        ? "雨で代わりの路線も止まるおそれがあります。"
        : "Alternative routes may stop in this rain.";
    case "low_confidence":
      if (!be) return buildNoAlternativeReason(input.language);
      if (!p50 || !p80) {
        return ja
          ? `${be}を過ぎると${target}が早く着きます。再開見込みには幅があります。`
          : `After ${be}, ${target} gets you there sooner. The outlook is still wide.`;
      }
      return ja
        ? `${be}を過ぎると${target}が早く着きます。再開見込みは${p50}〜${p80}頃です。`
        : `After ${be}, ${target} gets you there sooner. Restart is likely ${p50}–${p80}.`;
    case "estimate_extended":
      if (!p80 || !be) {
        return ja
          ? "延長後の見込みもさらに延びるおそれがあります。"
          : "The extended outlook may slip further.";
      }
      return ja
        ? `延長後の見込みは${p80}頃で境目より後です。`
        : `The extended outlook of ${p80} is past the ${be} cutoff.`;
    case "resume_after_break_even":
      if (!p50 || !be) {
        return ja ? "再開の見込みが境目より後です。" : "Restart is expected after the cutoff.";
      }
      return ja
        ? `再開は${p50}頃の見込みで境目より後です。`
        : `Restart is expected around ${p50}, after the ${be} cutoff.`;
    case "resume_mostly_after_break_even": {
      const minutes = input.breakEvenMinutesFromNow;
      if (!p50 || !p80 || !be || minutes === null) {
        return ja
          ? "再開見込みの大半が境目より後です。"
          : "Most of the restart outlook is after the cutoff.";
      }
      return ja
        ? `再開見込みの大半が境目より後です。${p50}〜${p80}頃の見込みで境目まであと${minutes}分です。`
        : `Most of the ${p50}–${p80} outlook is after the cutoff. Only ${minutes} min remain until ${be}.`;
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
          ? `再開見込みの${p50}頃と境目の差はわずかです。乗り換えるほどの差はありません。`
          : `Restart around ${p50} is close to the cutoff. Changing trains gains little.`;
      }
      return ja
        ? `再開は${p50}頃の見込みで境目より前です。`
        : `Restart is expected around ${p50}, before the cutoff.`;
    // 発表の時刻をもとにした推定であることが分かるよう、発表の見込みと「見込みどおりなら」を書く
    case "stated_resume_after_break_even":
      if (!p50 || !be) {
        return ja
          ? `発表の再開見込みでは${target}が早く着きます。`
          : `Even at the announced restart, ${target} is faster.`;
      }
      return ja
        ? `発表の再開が${p50}なら${target}が早く着きます。境目の${be}より後です。`
        : `Even at the announced ${p50} restart, ${target} is faster. It is after the ${be} cutoff.`;
    case "stated_resume_before_break_even":
      if (!p50 || !be || input.marginP50Minutes === null) {
        return ja
          ? "発表の見込みどおりなら待つほうが早く着きます。"
          : "If the announced restart holds, waiting is faster.";
      }
      if (input.marginP50Minutes < 0) {
        return ja
          ? `発表の再開${p50}と境目の差はわずかです。乗り換えるほどの差はありません。`
          : `The announced ${p50} restart is close to the cutoff. Changing trains gains little.`;
      }
      return ja
        ? `発表の再開が${p50}なら待つほうが早く着きます。`
        : `If the announced ${p50} restart holds, waiting is faster.`;
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
  if (target.transferService) return ja ? "振替輸送に切り替える" : "Use the transfer service.";
  return ja ? "別の路線に切り替える" : "Switch to another line.";
}

// 動かなかったときの次の手。待つ見出しの 2 文目に置く
function buildFallbackStep(input: DecisionTextInput): string | null {
  if (!input.bestOption) return null;
  const ja = input.language === "ja";
  const target = describeSwitchTarget(input.bestOption);
  if (target.kind === "taxi")
    return ja ? "動かなければタクシーへ" : "If still stopped, take a taxi.";
  if (target.line) {
    return ja ? `動かなければ${target.line}へ` : `If still stopped, take the ${target.line}.`;
  }
  return ja ? "動かなければ切り替える" : "If still stopped, switch.";
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
        : "Wait for service to resume.";
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
      return buildSwitchHeadline(input);
    case "resume_before_break_even":
    case "stated_resume_before_break_even": {
      if (input.flow?.outlook === "short") return waitHeadline;
      const minutes = input.breakEvenMinutesFromNow;
      if (minutes === null || minutes <= 0) return waitHeadline;
      return buildWaitUntilHeadline(input, waitHeadline);
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
      ? `${be}を過ぎると${target}が早く着きます。`
      : `After ${be}, ${target} gets you there sooner.`;
  }
  return buildDecisionReason(input);
}

// 見込みが立てやすい事象では、理由の頭に流れの一文を置き、確率があれば最後に 1 文で添える
// 確率の一文は流れの一文より先に残す
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
  const candidates = present([withChance(withFlow), withChance(base), withFlow]);
  return candidates.find((text) => [...text].length <= max) ?? base;
}

// 決定論モードの見出しと理由
export function buildDecisionText(input: DecisionTextInput): DecisionText {
  return { headline: buildDecisionHeadline(input), reason: composeReason(input) };
}

// 駅間の車内の理由の最後の手。着く見込みも流れも無いとき
function buildInCarFallbackReason(language: Lang): string {
  return language === "ja"
    ? "車内では列車が動くのを待ちます。"
    : "On board, wait for the train to move.";
}

export type InCarTextInput = {
  language: Lang;
  queue: TrainQueueText;
  // 理由に置く流れの一文。知見から見積もっているときだけ
  flowSentence: string | null;
};

// 駅間の車内の見出しと理由。切り替えの比較は書かず、次の駅に着く見込みと流れだけを書く
// 理由は上限に収まる最初の形にする。着く見込みの一文は流れの一文より先に残す
export function buildInCarDecisionText(input: InCarTextInput): DecisionText {
  const { language, queue, flowSentence } = input;
  const glue = language === "ja" ? "" : " ";
  const note = buildTrainQueueNote(queue, language);
  const short = buildShortTrainQueueNote(queue, language);
  const join = (a: string | null, b: string | null) => (a && b ? `${a}${glue}${b}` : null);
  const candidates = [
    join(note, flowSentence),
    note,
    join(short, flowSentence),
    short,
    flowSentence,
    buildInCarFallbackReason(language),
  ].filter((text): text is string => text !== null);
  return {
    headline: buildInCarHeadline(queue, language),
    reason: pickFitting(candidates, reasonLimits[language].max),
  };
}

// 長く止まったときの一文。線路に降りて歩く案内が出ることもあるので、係員の案内に従うよう添える
export function buildStaffNote(language: Lang): string {
  return language === "ja"
    ? "長く止まったときは係員の案内に従う。"
    : "If the stop runs long, follow the crew's instructions.";
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
  knowledge: { ja: "元指令員の知見を確かめています", en: "Checking the dispatcher knowledge" },
  weather: { ja: "雨量と警報を確かめています", en: "Checking rainfall and warnings" },
  phase: {
    ja: "段階と再開までの時間を見積もっています",
    en: "Estimating the phase and time to resumption",
  },
  alternatives: { ja: "代替経路を探しています", en: "Searching for alternative routes" },
  break_even: { ja: "境目の時刻を計算しています", en: "Computing the cutoff time" },
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
