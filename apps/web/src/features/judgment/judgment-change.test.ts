import type { JudgmentSchema, ResumeChanceSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import { buildJudgmentChange } from "./judgment-change";
import { buildTestRequest } from "./test-helpers";

type Judgment = z.infer<typeof JudgmentSchema>;
type ResumeChance = z.infer<typeof ResumeChanceSchema>;
const event = buildPersonAccidentEvents(buildTestRequest()).find(
  (event) => event.type === "judgment_ready",
);
if (event?.type !== "judgment_ready") throw new Error("判断の fixture がありません");
const judgment = event.judgment;

function buildJudgment(
  action: Judgment["action"],
  waitFaster: ResumeChance["waitFaster"],
): Judgment {
  return {
    ...judgment,
    action,
    breakEven: {
      time: "2026-11-05T23:00:00+09:00",
      explanation: "到着時刻の比較",
      resumeChance: {
        stepMinutes: 10,
        ticks: [10, 20, 30, 40].map((minutes) => ({
          time: `2026-11-05T23:${minutes}:00+09:00`,
          tenths: 5,
          sinceOnsetMinutes: minutes,
        })),
        waitFaster,
        waitOnTime: null,
        resumeByForDeadline: null,
        onsetTime: null,
      },
    },
  };
}

describe("buildJudgmentChange", () => {
  it("待つから切り替えへの変化に発表の要旨と同じ指標の確率を添える", () => {
    expect(
      buildJudgmentChange(
        buildJudgment("wait", 8),
        buildJudgment("switch", 2),
        "再開の見込みが延びました。振替輸送を実施しています。",
      ),
    ).toEqual({
      before: "wait",
      after: "switch",
      announcement: "再開の見込みが延びました。",
      beforeChance: 8,
      afterChance: 2,
    });
  });

  it.each([
    ["wait", "switch"],
    ["switch", "wait"],
    ["hold", "switch"],
    ["wait", "hold"],
    ["switch", "hold"],
    ["hold", "wait"],
  ] as const)("%s から %s への変化を順序どおり返す", (before, after) => {
    expect(
      buildJudgmentChange(buildJudgment(before, 0), buildJudgment(after, 10), null),
    ).toMatchObject({ before, after, beforeChance: 0, afterChance: 10, announcement: null });
  });

  it.each(["wait", "switch", "hold"] as const)(
    "%s の結論が同じなら確率や理由が変わっても表示しない",
    (action) => {
      expect(
        buildJudgmentChange(buildJudgment(action, 8), buildJudgment(action, 3), "発表"),
      ).toBeNull();
    },
  );

  it("英語の発表は小数点で切らず最初の一文を返す", () => {
    expect(
      buildJudgmentChange(
        buildJudgment("wait", 8),
        buildJudgment("switch", 2),
        "  Service resumes in 1.5 hours. Use another line.  ",
      )?.announcement,
    ).toBe("Service resumes in 1.5 hours.");
  });

  it("最初の判断と更新中は表示しない", () => {
    expect(buildJudgmentChange(null, judgment, "発表")).toBeNull();
    expect(buildJudgmentChange(judgment, null, "発表")).toBeNull();
  });

  it("確率がないときは値を補わず null にする", () => {
    expect(
      buildJudgmentChange(judgment, { ...judgment, action: "switch", breakEven: null }, " "),
    ).toMatchObject({ beforeChance: null, afterChance: null, announcement: null });
    expect(
      buildJudgmentChange(buildJudgment("wait", null), buildJudgment("switch", 4), null),
    ).toMatchObject({ beforeChance: null, afterChance: 4 });
  });

  it("長い発表は文字を壊さず50文字以内に収める", () => {
    const result = buildJudgmentChange(
      judgment,
      { ...judgment, action: "switch" },
      "🚆".repeat(60),
    );
    expect(Array.from(result?.announcement ?? "")).toHaveLength(50);
    expect(result?.announcement?.endsWith("…")).toBe(true);
  });
});
