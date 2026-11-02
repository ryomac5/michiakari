import {
  HEADWAY_MINUTES,
  type LineType,
  SCHEDULED_SPEED_KMH,
  TIME_OF_DAY_RANGES,
  type TimeOfDay,
} from "../params/transit.ts";
import { getJstMinuteOfDay } from "./time.ts";

// 時刻表がないための乗車時間と待ち時間の概算

// 乗車時間（分、切り上げ）= 距離 ÷ 路線種別の表定速度
export function computeRideMinutes(distanceKm: number, lineType: LineType): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError(`距離は 0 以上の有限値: ${distanceKm}`);
  }
  return Math.ceil((distanceKm / SCHEDULED_SPEED_KMH[lineType]) * 60);
}

// 待ち時間（分、切り上げ）= 運転間隔の半分
export function computeWaitMinutes(lineType: LineType, timeOfDay: TimeOfDay): number {
  return Math.ceil(HEADWAY_MINUTES[lineType][timeOfDay] / 2);
}

// 日本時間の時刻から時間帯を判定する
export function classifyTimeOfDay(iso: string): TimeOfDay {
  const minute = getJstMinuteOfDay(iso);
  const range = TIME_OF_DAY_RANGES.find((r) => minute >= r.startMinute && minute < r.endMinute);
  if (range === undefined) throw new RangeError(`時間帯の定義がない時刻です: ${iso}`);
  return range.timeOfDay;
}
