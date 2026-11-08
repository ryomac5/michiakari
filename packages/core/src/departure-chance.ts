import type { InCarChance, InCarGuide, Place, ResumeChanceTick } from "@repo/schema";
import { computeQuantile, sampleDurationDist } from "./remaining.ts";
import {
  CHANCE_TICK_END_QUANTILE,
  computeChanceWithin,
  listChanceTickTimes,
  roundChanceTenths,
} from "./resume-chance.ts";
import { diffMinutes, formatJstIso, parseIsoToMs } from "./time.ts";

// 駅間の車内の人の、時刻ごとの「自分の列車が動き出している」見込み
// 標本は、見出しの「動くのは」と同じ動き出す見込みの p50 と p80 から作る。駅にいる人の再開の見込みの図と同じ形で返す

const MS_PER_MINUTE = 60_000;
// 印の時刻が「ほぼ動いている」時刻よりこの分より後なら、目盛りに含めない。帯が間延びするため
const MARK_REACH_MINUTES = 60;

// 駅間の車内の人に勧める動き。alight は次の駅で降りる、stay は行き先まで乗り続ける
// unknown は動き出す見込みか次の駅が分からない。線路に降りる案内のときもこれに当たる
export type InCarPlan = "alight" | "stay" | "unknown";

export function decideInCarPlan(
  guide: Pick<InCarGuide, "alightStation" | "afterAlight" | "departure">,
  destination: Place,
): InCarPlan {
  if (!guide.alightStation) return "unknown";
  // 着いた後の一手があれば、次の駅で降りて別の手段に移る
  if (guide.afterAlight) return "alight";
  // 次の駅が行き先なら、そこで降りる
  if (destination.kind === "station" && destination.name === guide.alightStation) return "alight";
  if (!guide.departure) return "unknown";
  return "stay";
}

export type DepartureChanceInput = {
  now: string;
  // 自分の列車が動き出す見込みの時刻
  departure: { p50: string; p80: string };
  // 着く見込みの時刻と駅。無ければ null
  mark: { time: string; station: string } | null;
  onsetTime: string | null;
};

// いまから動き出すまでの分の標本（昇順）。p50 と p80 の分布から作る
export function sampleDepartureMinutes(
  now: string,
  departure: DepartureChanceInput["departure"],
): number[] {
  const p50 = Math.max(0, Math.round(diffMinutes(now, departure.p50)));
  const p80 = Math.max(p50, Math.round(diffMinutes(now, departure.p80)));
  return sampleDurationDist({ p50, p80 });
}

// 時刻 time までに動き出している確率
export function computeDepartedProbability(
  now: string,
  samples: readonly number[],
  time: string,
): number {
  return computeChanceWithin(samples, diffMinutes(now, time));
}

// 目盛りの終わり。ほぼ動いている時刻まで覆い、印の時刻が近ければそこまで延ばす
function selectTickEnd(
  nowMs: number,
  samples: readonly number[],
  mark: DepartureChanceInput["mark"],
): number {
  const nearlyCertainMs =
    nowMs + Math.max(0, computeQuantile(samples, CHANCE_TICK_END_QUANTILE)) * MS_PER_MINUTE;
  if (mark === null) return nearlyCertainMs;
  const markMs = parseIsoToMs(mark.time);
  const reachMs = nearlyCertainMs + MARK_REACH_MINUTES * MS_PER_MINUTE;
  return markMs > nearlyCertainMs && markMs <= reachMs ? markMs : nearlyCertainMs;
}

export function computeDepartureChance(input: DepartureChanceInput): InCarChance {
  const samples = sampleDepartureMinutes(input.now, input.departure);
  const nowMs = parseIsoToMs(input.now);
  const onsetMs = input.onsetTime === null ? null : parseIsoToMs(input.onsetTime);
  const { stepMinutes, times } = listChanceTickTimes(
    nowMs,
    selectTickEnd(nowMs, samples, input.mark),
  );
  const ticks: ResumeChanceTick[] = times.map((ms) => ({
    time: formatJstIso(ms),
    tenths: roundChanceTenths(computeDepartedProbability(input.now, samples, formatJstIso(ms))),
    sinceOnsetMinutes:
      onsetMs === null ? null : Math.max(0, Math.round((ms - onsetMs) / MS_PER_MINUTE)),
  }));
  const mark = input.mark
    ? {
        time: input.mark.time,
        station: input.mark.station,
        tenths: roundChanceTenths(computeDepartedProbability(input.now, samples, input.mark.time)),
      }
    : null;
  return { stepMinutes, ticks, mark, onsetTime: input.onsetTime };
}
