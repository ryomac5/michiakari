import type { Judgment, ResumeQueue, RouteOption, StopReason, UnaffectedTrack } from "@repo/schema";

// 規則から出した見込みを、画面の短い行にする。文は訳の鍵で選び、数字の幅だけを渡す
// 乗り換え先の並びは agent が決める。画面では並べ替えない

// 「10〜15 分ほど」の形の幅。下が 0 か上と同じなら 1 つの数にする。上も 0 なら soon
export type MinuteRange =
  | { kind: "range"; min: number; max: number }
  | { kind: "single"; minutes: number }
  | { kind: "soon" };

export type TrackLine =
  // 反対の線路や並ぶ線が先に動く見込み
  | { side: "opposite"; range: MinuteRange; labeled: boolean }
  // 当該の線路は長く止まる見込み
  | { side: "affected"; labeled: boolean };

export type QueueLines = {
  // 動き出しても先へ進むまでの幅。詰めない事業者や前に列車が無ければ null
  wait: MinuteRange | null;
  // 次の駅で降りて乗り換える価値があるか
  alight: boolean;
  // 乗り換え先の行。agent の並びで先頭の、待つ以外の選択肢。無ければ null
  alightOptionId: string | null;
};

export function buildMinuteRange(min: number, max: number): MinuteRange {
  if (max <= 0) return { kind: "soon" };
  if (min <= 0 || min === max) return { kind: "single", minutes: max };
  return { kind: "range", min, max };
}

// 防護無線の事象のときだけ、1 行の読みを出す
export function checkProtectionReading(judgment: Pick<Judgment, "protection">): boolean {
  return judgment.protection === true;
}

// 電車の中の判断で出す、止まった理由の 1 行。防護無線の読みが出ていれば、同じ意味の行を重ねない
export function selectStopReasonLine(
  judgment: Pick<Judgment, "protection" | "stopReasons">,
): StopReason | null {
  const reason = judgment.stopReasons?.mostLikely ?? null;
  if (reason === "protection_received" && checkProtectionReading(judgment)) return null;
  return reason;
}

// 支障の無い線路の行。利用者の側が分からなければ両方を並べ、分かればその側の 1 行だけにする
export function selectTrackLines(track: UnaffectedTrack | undefined): TrackLine[] {
  if (!track) return [];
  const labeled = track.trackSide === "unknown";
  const opposite: TrackLine[] =
    track.trackSide !== "affected" && track.opposite
      ? [
          {
            side: "opposite",
            range: buildMinuteRange(track.opposite.p50, track.opposite.p80),
            labeled,
          },
        ]
      : [];
  const affected: TrackLine[] =
    track.trackSide !== "opposite" ? [{ side: "affected", labeled }] : [];
  return [...opposite, ...affected];
}

// 乗り換え先の行。agent の並びをそのまま使い、待つ以外の先頭を選ぶ
export function selectAlightOptionId(options: readonly RouteOption[]): string | null {
  return options.find((o) => o.kind !== "wait")?.id ?? null;
}

// 再開後の詰まりの行。どちらも出さないなら null
export function selectQueueLines(
  queue: ResumeQueue | undefined,
  options: readonly RouteOption[],
): QueueLines | null {
  if (!queue) return null;
  const range = queue.waitRange;
  const wait =
    range && queue.trainsInQueue > 0 && range.maxMinutes > 0
      ? buildMinuteRange(range.minMinutes, range.maxMinutes)
      : null;
  const alight = queue.worthAlightingAtNextStation;
  if (wait === null && !alight) return null;
  return { wait, alight, alightOptionId: alight ? selectAlightOptionId(options) : null };
}

// judgment.rules の訳を引く
export type RuleTranslate = (key: string, values?: Record<string, string | number>) => string;

export function formatMinuteRange(t: RuleTranslate, range: MinuteRange): string {
  if (range.kind === "range") return t("range", { min: range.min, max: range.max });
  if (range.kind === "single") return t("single", { minutes: range.minutes });
  return "";
}

export function formatTrackLine(t: RuleTranslate, line: TrackLine): string {
  if (line.side === "affected") return t("track.affected");
  return line.range.kind === "soon"
    ? t("track.oppositeSoon")
    : t("track.opposite", { range: formatMinuteRange(t, line.range) });
}

export function formatQueueWait(t: RuleTranslate, wait: MinuteRange): string {
  return t("queue.wait", { range: formatMinuteRange(t, wait) });
}
