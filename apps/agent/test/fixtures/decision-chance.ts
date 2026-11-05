import type { ResumeChance } from "@repo/schema";

const ticks = [
  { time: "2026-11-05T22:40:00+09:00", tenths: 1, sinceOnsetMinutes: null },
  { time: "2026-11-05T22:50:00+09:00", tenths: 2, sinceOnsetMinutes: null },
  { time: "2026-11-05T23:00:00+09:00", tenths: 6, sinceOnsetMinutes: null },
  { time: "2026-11-05T23:10:00+09:00", tenths: 9, sinceOnsetMinutes: null },
];

// 判断の比較時点が異なる架空の確率
export const decisionChances = {
  deadline: {
    stepMinutes: 10,
    ticks,
    waitFaster: 1,
    waitOnTime: 2,
    resumeByForDeadline: "2026-11-05T22:50:00+09:00",
    onsetTime: null,
  },
  close: {
    stepMinutes: 10,
    ticks,
    waitFaster: 2,
    waitOnTime: null,
    resumeByForDeadline: null,
    onsetTime: null,
  },
  mostlyLate: {
    stepMinutes: 10,
    ticks: [
      { time: "2026-11-05T22:40:00+09:00", tenths: 5, sinceOnsetMinutes: null },
      { time: "2026-11-05T22:50:00+09:00", tenths: 7, sinceOnsetMinutes: null },
      { time: "2026-11-05T23:00:00+09:00", tenths: 9, sinceOnsetMinutes: null },
      { time: "2026-11-05T23:10:00+09:00", tenths: 10, sinceOnsetMinutes: null },
    ],
    waitFaster: 6,
    waitOnTime: null,
    resumeByForDeadline: null,
    onsetTime: null,
  },
} satisfies Record<string, ResumeChance>;
