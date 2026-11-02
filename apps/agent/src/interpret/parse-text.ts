import { formatJstIso, getJstMinuteOfDay, parseIsoToMs } from "@repo/core";
import type { Section } from "@repo/schema";
import type { LineInfo } from "../alternatives/provider.ts";

// 発表文から区間・路線・見込み時刻・振替輸送を拾う

const SECTION_PATTERN =
  /([一-龥々ヶァ-ヶーA-Za-z0-9]+?)駅?[〜～]([一-龥々ヶァ-ヶーA-Za-z0-9]+?)駅?(?=間|\s|$|[、。])/g;
const CLOCK_PATTERN = /(\d{1,2})時(\d{1,2})分|(\d{1,2}):(\d{2})/;

const MS_PER_MINUTE = 60_000;
const HALF_DAY_MINUTES = 12 * 60;

// 最後に現れる区間（止まっている区間であることが多い）を返す
export function parseSection(text: string): Section | null {
  const matches = [...text.normalize("NFKC").matchAll(SECTION_PATTERN)];
  const last = matches.at(-1);
  if (!last?.[1] || !last[2]) return null;
  return { fromStation: last[1], toStation: last[2] };
}

export function parseLine(text: string, lines: readonly LineInfo[]): LineInfo | null {
  const normalized = text.normalize("NFKC");
  let best: { line: LineInfo; at: number } | null = null;
  for (const line of lines) {
    const at = normalized.indexOf(line.name.normalize("NFKC"));
    if (at >= 0 && (best === null || at < best.at)) best = { line, at };
  }
  return best?.line ?? null;
}

// 時刻（日本時間の時・分）を、基準時刻の前後 12 時間に収まる日付で ISO にする
export function resolveClockNearTime(
  hours: number,
  minutes: number,
  referenceIso: string,
): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59)
    return null;
  let diff = hours * 60 + minutes - getJstMinuteOfDay(referenceIso);
  if (diff < -HALF_DAY_MINUTES) diff += 24 * 60;
  if (diff > HALF_DAY_MINUTES) diff -= 24 * 60;
  const referenceMinuteMs = Math.floor(parseIsoToMs(referenceIso) / MS_PER_MINUTE) * MS_PER_MINUTE;
  return formatJstIso(referenceMinuteMs + diff * MS_PER_MINUTE);
}

// 「見込」を含む文の時刻を再開見込み時刻とする
export function parseStatedResumeTime(text: string, observedAt: string): string | null {
  const sentences = text.normalize("NFKC").split(/[。．\n]/);
  for (const sentence of sentences) {
    if (!sentence.includes("見込")) continue;
    const m = sentence.match(CLOCK_PATTERN);
    if (!m) continue;
    const resolved = resolveClockNearTime(Number(m[1] ?? m[3]), Number(m[2] ?? m[4]), observedAt);
    if (resolved) return resolved;
  }
  return null;
}

export function parseTransferServiceActive(text: string): boolean | null {
  const normalized = text.normalize("NFKC");
  if (!normalized.includes("振替輸送")) return null;
  if (/振替輸送(は|を)?(行って|実施して|ご利用)/.test(normalized)) return true;
  if (/振替輸送(は|を)?(行っておりません|終了|実施しておりません)/.test(normalized)) return false;
  return null;
}
