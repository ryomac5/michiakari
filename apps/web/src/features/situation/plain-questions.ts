import { formatIsoWithOffset } from "@/features/judgment/time";

// 何も分からない人にも答えられる問いの選択肢。原因の大分類は cause-categories.ts にある

// 止まってからの分。いま止まったは 0、分からなければ null
export const elapsedOptions = [
  { id: "now", minutes: 0 },
  { id: "m10", minutes: 10 },
  { id: "m30", minutes: 30 },
  { id: "unknown", minutes: null },
] as const;

export type ElapsedOption = (typeof elapsedOptions)[number];

export function findElapsedOption(id: ElapsedOption["id"]): ElapsedOption {
  return elapsedOptions.find((o) => o.id === id) ?? elapsedOptions[3];
}

// 再開の見込みを放送で言っていたか。時刻を言っていたなら、続けて時刻を選ぶ
export const resumeOptions = ["stated", "undecided", "unknown"] as const;
export type ResumeOptionId = (typeof resumeOptions)[number];

// 放送で聞いた再開見込みの時刻の候補。いまを 10 分刻みに切り上げ、そこから 10 分おきに並べる
// 放送の見込みは「23時00分頃」のように切りのよい時刻が多いので、正時と半はこの並びに必ず入る
export const resumeTimeStepMinutes = 10;
export const resumeTimeCount = 8;

export type ResumeTimeOption = { id: string; iso: string };

export function listResumeTimeOptions(now: Date): ResumeTimeOption[] {
  const step = resumeTimeStepMinutes * 60_000;
  const first = Math.ceil((now.getTime() + 1) / step) * step;
  return Array.from({ length: resumeTimeCount }, (_, i) => {
    const date = new Date(first + i * step);
    const id = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    return { id, iso: formatIsoWithOffset(date) };
  });
}
