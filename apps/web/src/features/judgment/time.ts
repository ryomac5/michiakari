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
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

// 文の中に差し込む時刻。「21:40」を ja は「21時40分」、en は「21:40」にする。札と図には「21:40」のまま使う
export function spellClockInSentence(clock: string, locale: string): string {
  if (locale !== "ja") return clock;
  const [hh = "", mm = ""] = clock.split(":");
  return `${Number(hh)}時${mm.padStart(2, "0")}分`;
}

// 文の中に差し込む日本時間の時刻
export function formatClockInSentence(iso: string, locale: string): string {
  return spellClockInSentence(formatClockTime(iso, "en"), locale);
}

// 残り時間の表し方。時刻と紛れないよう「あと13分」の形にし、1 分未満は「まもなく」とする
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

// 判断の基準時刻から数えた残り時間。見出しの「あと23分」は基準時刻からの分を四捨五入した値なので、
// 同じ丸め方で基準時刻からの分を出し、基準時刻から経った分だけ減らす。見出しと表示の数字がそろう
export function computeCountdownFrom(targetIso: string, basisIso: string, now: Date): Countdown {
  const targetMs = Date.parse(targetIso);
  const basisMs = Date.parse(basisIso);
  const totalSeconds = Math.floor((targetMs - now.getTime()) / 1000);
  const passed = totalSeconds <= 0;
  const basisMinutes = Math.round((targetMs - basisMs) / 60_000);
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - basisMs) / 60_000));
  const remaining = Math.max(0, basisMinutes - elapsedMinutes);
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  const kind = passed ? "passed" : remaining < 1 ? "imminent" : hours > 0 ? "hours" : "minutes";
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
