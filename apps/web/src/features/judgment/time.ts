import { timeZone } from "@/i18n/config";

// 時刻の表示と残り時間の計算。表示用の整形だけを行い、判断に使う数値は扱わない

function padTwo(n: number): string {
  return String(Math.trunc(n)).padStart(2, "0");
}

// 端末の時差を付けた ISO 8601（秒まで）に変換する
export function formatIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const day = `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
  const clock = `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`;
  return `${day}T${clock}${sign}${padTwo(abs / 60)}:${padTwo(abs % 60)}`;
}

// 日本時間の HH:MM
export function formatClockTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

// 残り時間の表し方。時刻と紛れないよう「あと 13 分」の形にし、1 分未満は「まもなく」とする
export type Countdown = {
  totalSeconds: number;
  passed: boolean;
  kind: "minutes" | "hours" | "imminent" | "passed";
  hours: number;
  minutes: number;
};

// 目標時刻までの残り時間。分は切り捨てる
export function computeCountdown(targetIso: string, now: Date): Countdown {
  const totalSeconds = Math.floor((Date.parse(targetIso) - now.getTime()) / 1000);
  const passed = totalSeconds <= 0;
  const remaining = Math.max(0, totalSeconds);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const kind = passed ? "passed" : remaining < 60 ? "imminent" : hours > 0 ? "hours" : "minutes";
  return { totalSeconds, passed, kind, hours, minutes };
}

// 運賃の表示。null は「—」
export function formatFare(fareYen: number | null, locale: string): string {
  if (fareYen === null) return "—";
  return new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en-US", {
    style: "currency",
    currency: "JPY",
  }).format(fareYen);
}
