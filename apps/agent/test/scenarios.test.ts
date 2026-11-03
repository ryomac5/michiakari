import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { createTestApp, createTestDeps, replayScenario } from "./helpers.ts";

// 決定論モードで、ダミーの各シナリオの expectations を満たすことを確かめる
// 期待値はシナリオの YAML から読み、コードに埋め込まない

const deps = createTestDeps();
const scenarios = [...deps.content.scenarios.values()];

function findJudgment(events: JudgmentEvent[]) {
  const ready = events.find((e) => e.type === "judgment_ready");
  return ready?.type === "judgment_ready" ? ready.judgment : null;
}

describe("決定論モードのシナリオ", () => {
  it("ダミーのシナリオが 4 件読める", () => {
    expect(scenarios).toHaveLength(4);
  });

  for (const scenario of scenarios) {
    describe(scenario.id, () => {
      const app = createTestApp(deps);
      const stepsPromise = replayScenario(app, scenario);

      it("すべての観測で、見出しが目安の長さに収まる", async () => {
        const steps = await stepsPromise;
        const limit = headlineLimits[scenario.user.language].target;
        for (const step of steps) {
          const headline = findJudgment(step.events)?.headline ?? "";
          expect(headline.length, step.entry.id).toBeGreaterThan(0);
          expect([...headline].length, step.entry.id).toBeLessThanOrEqual(limit);
        }
      });

      it("すべての観測で、理由が空でなく上限に収まり、分岐点の説明と重ならない", async () => {
        const steps = await stepsPromise;
        const { max } = reasonLimits[scenario.user.language];
        for (const step of steps) {
          const judgment = findJudgment(step.events);
          const reason = judgment?.reason ?? "";
          expect(reason.length, step.entry.id).toBeGreaterThan(0);
          expect([...reason].length, step.entry.id).toBeLessThanOrEqual(max);
          expect(judgment?.breakEven?.explanation ?? "", step.entry.id).not.toContain(reason);
        }
      });

      for (const expectation of scenario.expectations) {
        it(`${expectation.after} の後: ${expectation.note}`, async () => {
          const steps = await stepsPromise;
          const step = steps.find((s) => s.entry.id === expectation.after);
          const judgment = step ? findJudgment(step.events) : null;
          expect(judgment, "judgment_ready が届くこと").not.toBeNull();
          if (!judgment) return;

          if (expectation.action !== undefined) expect(judgment.action).toBe(expectation.action);
          if (expectation.phase !== undefined)
            expect(judgment.estimate.phaseId).toBe(expectation.phase);
          if (expectation.evidence_includes !== undefined) {
            const signalIds = judgment.evidence.filter((e) => e.kind === "signal").map((e) => e.id);
            expect(signalIds).toEqual(expect.arrayContaining(expectation.evidence_includes));
          }
          if (expectation.break_even_shown !== undefined) {
            expect(judgment.breakEven !== null).toBe(expectation.break_even_shown);
          }
        });
      }
    });
  }
});
