import { findIncidentType } from "@repo/core";
import { ANNOUNCEMENT_CUE_IDS, type JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { createTestApp, createTestDeps, replayScenario } from "./helpers.ts";

// 決定論モードで、ダミーの各シナリオの expectations を満たすことを確かめる
// 期待値はシナリオの YAML から読み、コードに埋め込まない
// phase は判断が段階を持たないので検査しない。evidence_includes は根拠の cue の id と照合する

const deps = createTestDeps();
const scenarios = [...deps.content.scenarios.values()];

function findJudgment(events: JudgmentEvent[]) {
  const ready = events.find((e) => e.type === "judgment_ready");
  return ready?.type === "judgment_ready" ? ready.judgment : null;
}

describe("決定論モードのシナリオ", () => {
  it("ダミーのシナリオが 5 件読める", () => {
    expect(scenarios).toHaveLength(5);
  });

  for (const scenario of scenarios) {
    describe(scenario.id, () => {
      const app = createTestApp(deps);

      it("event_type が統計値の種類の id で、evidence_includes が手がかりの id である", () => {
        expect(findIncidentType(scenario.event_type)).toBe(scenario.event_type);
        for (const e of scenario.expectations) {
          for (const id of e.evidence_includes ?? []) {
            expect(ANNOUNCEMENT_CUE_IDS as readonly string[]).toContain(id);
          }
        }
      });
      const stepsPromise = replayScenario(app, scenario);

      it("すべての観測で、見出しが目安の長さに収まる", async () => {
        const steps = await stepsPromise;
        const { target, max } = headlineLimits[scenario.user.language];
        for (const step of steps) {
          const headline = findJudgment(step.events)?.headline ?? "";
          expect(headline.length, step.entry.id).toBeGreaterThan(0);
          // 1 文目が大きく出る行動。2 文目は動かなかったときの次の手
          const lead = headline.split(/。|(?<=\.)\s/)[0] ?? "";
          expect([...lead].length, step.entry.id).toBeLessThanOrEqual(target);
          expect([...headline].length, step.entry.id).toBeLessThanOrEqual(max);
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
          if (expectation.evidence_includes !== undefined) {
            const cueIds = judgment.evidence.filter((e) => e.kind === "cue").map((e) => e.id);
            expect(cueIds).toEqual(expect.arrayContaining(expectation.evidence_includes));
          }
          if (expectation.break_even_shown !== undefined) {
            expect(judgment.breakEven !== null).toBe(expectation.break_even_shown);
          }
        });
      }
    });
  }
});
