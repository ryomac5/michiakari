import { IsoDateTimeSchema } from "@repo/schema";

// 日時の補助。出力はすべて日本時間（+09:00）の ISO 8601

const MS_PER_MINUTE = 60_000;
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE;

// オフセット付き ISO 8601 を検証し、エポックミリ秒に変換する
export function parseIsoToMs(iso: string): number {
  const result = IsoDateTimeSchema.safeParse(iso);
  if (!result.success) {
    throw new RangeError(`オフセット付きの ISO 8601 日時ではありません: ${iso}`);
  }
  return Date.parse(result.data);
}

// エポックミリ秒を +09:00 の ISO 8601（秒まで）に整形する
export function formatJstIso(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${date}T${time}+09:00`;
}

// ISO 日時に分を足し、+09:00 の ISO 日時を返す
export function addMinutesToIso(iso: string, minutes: number): string {
  return formatJstIso(parseIsoToMs(iso) + minutes * MS_PER_MINUTE);
}

// to − from を分で返す（小数を含む）
export function diffMinutes(fromIso: string, toIso: string): number {
  return (parseIsoToMs(toIso) - parseIsoToMs(fromIso)) / MS_PER_MINUTE;
}

// 日本時間の 0 時からの経過分（0〜1439）を返す
export function getJstMinuteOfDay(iso: string): number {
  const d = new Date(parseIsoToMs(iso) + JST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
