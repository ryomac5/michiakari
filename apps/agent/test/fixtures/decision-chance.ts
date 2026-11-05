import type { ResumeChance } from "@repo/schema";

// 判断の比較時点が異なる架空の確率
export const decisionChances = {
  deadline: {
    stepMinutes: 10,
    ticks: [],
    waitFaster: 1,
    waitOnTime: 2,
    resumeByForDeadline: "2026-11-05T22:50:00+09:00",
    onsetTime: null,
  },
  close: {
    stepMinutes: 10,
    ticks: [],
    waitFaster: 2,
    waitOnTime: null,
    resumeByForDeadline: null,
    onsetTime: null,
  },
  mostlyLate: {
    stepMinutes: 10,
    ticks: [],
    waitFaster: 6,
    waitOnTime: null,
    resumeByForDeadline: null,
    onsetTime: null,
  },
} satisfies Record<string, ResumeChance>;
