import { describe, expect, it } from "vitest";
import { assembleJudgment, extractTextNumbers } from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import { formatClock } from "../src/judge/templates.ts";
import { DecisionSchema } from "../src/tools/emit-judgment.ts";
import { buildScenarioRequest, createTestDeps } from "./helpers.ts";

// assembleJudgment が数値をツールの結果から取り、決定に混ぜた数値を無視することを確かめる

const deps = createTestDeps();

async function prepareSession() {
  const scenario = [...deps.content.scenarios.values()][0];
  const entry = scenario?.timeline[0];
  if (!scenario || !entry) throw new Error("シナリオがありません");
  const request = buildScenarioRequest(scenario, entry, []);
  const eventType = scenario.event_type;
  const knowledge = deps.content.knowledge.get(eventType);
  const signal = knowledge?.phases[0]?.signals[0];
  if (!knowledge || !signal) throw new Error("知見がありません");
  const observation = {
    id: entry.id,
    observedAt: request.now,
    source: "scenario" as const,
    rawText: entry.text.ja,
    eventTypeCandidates: [{ eventType, confidence: "high" as const }],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [{ eventType, signalId: signal.id, quote: "引用" }],
  };
  const session = createJudgeSession(
    {
      request,
      observations: [observation],
      content: deps.content,
      provider: deps.provider,
      scenario,
      fetchRain: deps.fetchRain,
    },
    createEventSink(
      async () => {},
      () => request.now,
    ),
  );
  await session.executeTool("estimate_phase_and_remaining", { eventType });
  await session.executeTool("find_alternatives", {});
  await session.executeTool("compute_break_even", {});
  const { estimate, alternatives, breakEven } = session.state;
  if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
  return { session, results: { estimate, alternatives, breakEven }, signalId: signal.id, request };
}

describe("assembleJudgment", () => {
  it("決定に混ぜた数値を無視し、ツールの結果の数値を使う", async () => {
    const { results, signalId } = await prepareSession();
    const tampered = {
      action: "hold",
      headline: "様子を見ましょう",
      breakEvenExplanation: "説明",
      recommendedOptionId: null,
      evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      // Claude が数値を入れてきた場合
      estimate: {
        eventType: "x",
        phaseId: "y",
        elapsedMinutes: 999,
        remaining: { p50: 1, p80: 2 },
        confidence: "high",
      },
      breakEven: { time: "2000-01-01T00:00:00+09:00", explanation: "改ざん" },
      options: [],
      fareYen: 1,
    };
    const decision = DecisionSchema.parse(tampered);
    expect(Object.keys(decision).sort()).toEqual(
      ["action", "breakEvenExplanation", "evidence", "headline", "recommendedOptionId"].sort(),
    );
    const judgment = assembleJudgment(
      results,
      { ...decision, ...tampered } as typeof decision,
      "ja",
    );
    expect(judgment.estimate).toEqual(results.estimate.estimate);
    expect(judgment.options).toEqual(results.alternatives.options);
    const r = results.breakEven.result;
    if (r.kind !== "future" && r.kind !== "passed") throw new Error("分岐点がありません");
    expect(judgment.breakEven).toEqual({ time: r.time, explanation: "説明" });
    expect(judgment.disclaimer.length).toBeGreaterThan(0);
  });
});

describe("validateJudgment", () => {
  it("ツールの結果に無い根拠・時刻・推奨を指摘する", async () => {
    const { session, results, request } = await prepareSession();
    const judgment = assembleJudgment(
      results,
      {
        action: "switch",
        headline: "3時33分までに切り替えてください",
        breakEvenExplanation: "説明",
        recommendedOptionId: "wait",
        evidence: [{ kind: "signal", id: "unknown_signal", description: "根拠" }],
      },
      "ja",
    );
    const { judgment: valid, errors } = session.checkJudgment(judgment, results);
    expect(valid).toBeNull();
    expect(errors.some((e) => e.includes("unknown_signal"))).toBe(true);
    expect(errors.some((e) => e.includes("3時33分"))).toBe(true);
    expect(errors.some((e) => e.includes("switch"))).toBe(true);
  });

  it("分・円・時だけの表記と英語の数値を、根拠の説明も含めて検査する", async () => {
    const { session, results, signalId } = await prepareSession();
    const fare = results.alternatives.options.find((o) => o.fareYen !== null)?.fareYen;
    if (fare === undefined || fare === null) throw new Error("運賃のある選択肢がありません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `あと 7777分で再開します。タクシーは${fare.toLocaleString("ja-JP")}円です`,
        breakEvenExplanation: "3時ごろまで待ちましょう。about 999 min, ¥12,345 or 54321 yen",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "8881分で直ります" }],
      },
      "ja",
    );
    const { errors } = session.checkJudgment(judgment, results);
    const joined = errors.join("\n");
    for (const raw of ["7777分", "3時", "999 min", "¥12,345", "54321 yen", "8881分"]) {
      expect(joined).toContain(raw);
    }
    expect(joined).not.toContain(`${fare.toLocaleString("ja-JP")}円`);
    expect(errors.filter((e) => e.startsWith("evidence[0].description"))).toHaveLength(1);
  });

  it("ツールの結果の残り時間・徒歩・運賃の数値なら通る", async () => {
    const { session, results, signalId } = await prepareSession();
    const remaining = results.estimate.estimate.remaining;
    const option = results.alternatives.options.find((o) => o.kind === "transfer");
    const fare = results.alternatives.options.find((o) => o.fareYen !== null)?.fareYen;
    if (!remaining || !option || fare === undefined || fare === null)
      throw new Error("前提がそろいません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `再開まで約${remaining.p50}分、遅いと${remaining.p80}分`,
        breakEvenExplanation: `振替は徒歩${option.walkMinutes}分、タクシーは ¥${fare}`,
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: `p50 ${remaining.p50} min` }],
      },
      "ja",
    );
    expect(session.checkJudgment(judgment, results).errors).toEqual([]);
  });

  it("ツールの結果の時刻と根拠だけなら通る", async () => {
    const { session, results, signalId, request } = await prepareSession();
    const r = results.breakEven.result;
    if (r.kind !== "future" && r.kind !== "passed") throw new Error("分岐点がありません");
    const judgment = assembleJudgment(
      results,
      {
        action: "hold",
        headline: `${formatClock(r.time, "ja")}までに再開しなければ切り替えを考えましょう`,
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [{ kind: "signal", id: signalId, description: "根拠" }],
      },
      "ja",
    );
    const checked = session.checkJudgment(judgment, results);
    expect(checked.errors).toEqual([]);
  });
});

describe("extractTextNumbers", () => {
  it("時刻の中の分を分の数値として二重に拾わない", () => {
    const n = extractTextNumbers(
      "23時16分までに再開しなければ、徒歩12分の経路が早い。2時間5分かかる。8時ごろ",
    );
    expect(n.clocks.map((c) => c.minuteOfDay)).toEqual([23 * 60 + 16]);
    expect(n.minutes.map((m) => m.value)).toEqual([125, 12]);
    expect(n.hours.map((h) => h.hour)).toEqual([8]);
  });
});
