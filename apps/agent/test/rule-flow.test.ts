import type { JudgeRequest, Judgment, JudgmentEvent, Lang } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { findFlowWording } from "../src/domain/flow-wording.ts";
import { assembleJudgment } from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import { createTestApp, createTestDeps, postJudge, replayScenario } from "./helpers.ts";

// 規則表と統計値から出す見込み。判断は段階を持たず、結論の文は再開までの時間を言い切らない。決定論モードとダミーのシナリオで確かめる

const deps = createTestDeps();
const app = createTestApp(deps);

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

// 入口の「放送で聞いた原因を選ぶ」で原因を選んだときと同じ形の要求
function buildSelectionRequest(eventType: string | null, language: Lang = "ja"): JudgeRequest {
  return {
    observations: [],
    newInput: eventType ? { type: "selection", eventType, signalIds: [] } : null,
    origin: { kind: "station", name: "京橋" },
    destination: { kind: "station", name: "天王寺" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language,
    now: "2026-11-09T18:25:00+09:00",
  };
}

// 結論の見出しと理由に、事象の決まった流れや再開までの時間を言い切る言い方が無いことを確かめる
function expectNoFlowWording(judgment: Judgment, language: Lang = "ja"): void {
  for (const text of [judgment.headline, judgment.reason ?? ""]) {
    expect(findFlowWording(text, language), text).toBeNull();
  }
}

describe("規則表から出す見込み", () => {
  it("人身事故の判断は規則と統計値で見込み、段階もよくある流れも載せない", async () => {
    const scenario = deps.content.scenarios.get("person_accident_last_train");
    if (!scenario) throw new Error("ダミーのシナリオがありません");
    const [first] = await replayScenario(app, {
      ...scenario,
      timeline: scenario.timeline.slice(0, 1),
    });
    const judgment = findJudgment(first?.events ?? []);
    expect(judgment.estimate).toMatchObject({
      eventType: "person_collision",
      phaseId: null,
      source: "rule",
    });
    expect(judgment.typicalFlow).toBeUndefined();
    expect(judgment.protection).toBe(true);
    // 理由は待つ場合との比較で書き、再開までの時間を事象の流れとして言い切らない
    expect(judgment.reason).toMatch(
      /^待つより.+のほうが早く着きます。再開は\d{1,2}時\d{2}分ごろの見込みです。/,
    );
    expectNoFlowWording(judgment);
  });

  it("原因が分からない判断は、種類も段階も持たない", async () => {
    const judgment = findJudgment(await postJudge(app, buildSelectionRequest(null)));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.phaseId).toBeNull();
    expect(judgment.typicalFlow).toBeUndefined();
  });

  it("入口で急病人の救護を選ぶと、短い事象の目安で待つと言い切り、安心させる言葉を使う", async () => {
    const judgment = findJudgment(await postJudge(app, buildSelectionRequest("medical_response")));
    // 種類が分かり短い事象の目安を使うので、確信度は中になる
    expect(judgment.estimate.confidence).toBe("medium");
    expect(judgment.action).toBe("wait");
    expect(judgment.headline).toBe("このまま待つ");
    expect(judgment.reason).toMatch(
      /^待つほうが早く着きます。再開は\d{1,2}時\d{2}分ごろの見込みです。/,
    );
    expectNoFlowWording(judgment);
  });

  it("英語でも同じ方針で、数値の検査を通る", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildSelectionRequest("medical_response", "en")),
    );
    expect(judgment.action).toBe("wait");
    expect(judgment.headline).toBe("Stay and wait.");
    expect(judgment.reason).toMatch(
      /^Waiting gets you there sooner\. Restart is expected around \d{2}:\d{2}\./,
    );
    expectNoFlowWording(judgment, "en");
  });
});

describe("長く止まる種類の言い切りと確信度", () => {
  async function replayPersonAccident() {
    const scenario = deps.content.scenarios.get("person_accident_last_train");
    if (!scenario) throw new Error("ダミーのシナリオがありません");
    return replayScenario(app, scenario);
  }

  it("人身事故の obs_1 は、分岐点まで時間があっても切り替えになる", async () => {
    const steps = await replayPersonAccident();
    const judgment = findJudgment(steps.find((s) => s.entry.id === "obs_1")?.events ?? []);
    expect(judgment.action).toBe("switch");
    expect(judgment.headline).toMatch(/^.+まで歩いて.+へ$|^.+に乗り換える$/);
    expectNoFlowWording(judgment);
    // 統計値だけの見込みで、再開が近い手がかりも無いので確信度は低い
    expect(judgment.estimate.confidence).toBe("low");
  });

  it("発表の時刻で見込むと確信度は高く、延びたら中に下げる", async () => {
    const steps = await replayPersonAccident();
    const confidenceAt = (id: string) =>
      findJudgment(steps.find((s) => s.entry.id === id)?.events ?? []).estimate.confidence;
    expect(confidenceAt("obs_3")).toBe("high");
    expect(confidenceAt("obs_4")).toBe("medium");
  });

  it("発表された見込みがあれば、統計値より発表の時刻で比べて待つ", async () => {
    const steps = await replayPersonAccident();
    const judgment = findJudgment(steps.find((s) => s.entry.id === "obs_3")?.events ?? []);
    expect(judgment.action).toBe("wait");
    expect(judgment.reason).toContain("22時50分");
  });
});

describe("claude モードの数値の検査", () => {
  // 入口で人身事故を選んだ場面のセッションを作り、ツールを順に呼ぶ
  async function prepareSession() {
    const request = buildSelectionRequest("person_collision");
    const observation = {
      id: "obs_1",
      observedAt: request.now,
      source: "selection" as const,
      eventTypeCandidates: [{ eventType: "person_collision", confidence: "high" as const }],
      operator: null,
      line: null,
      section: null,
      statedResumeTime: null,
      transferServiceActive: null,
      detectedSignals: [],
    };
    const session = createJudgeSession(
      {
        request,
        observations: [observation],
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      },
      createEventSink(
        async () => {},
        () => request.now,
      ),
    );
    await session.executeTool("estimate_remaining", { eventType: "person_collision" });
    await session.executeTool("find_alternatives", {});
    await session.executeTool("compute_break_even", {});
    const { estimate, alternatives, breakEven } = session.state;
    if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
    return { session, results: { estimate, alternatives, breakEven } };
  }

  function buildDecision(reason: string) {
    return {
      action: "hold" as const,
      headline: "このまま待ちましょう",
      reason,
      breakEvenExplanation: "説明",
      recommendedOptionId: null,
      evidence: [],
    };
  }

  it("境目との比較の文は通り、事象の流れや段階で語る文とツールに無い時間は指摘する", async () => {
    const { session, results } = await prepareSession();
    expect(results.estimate.flowOutlook).toBe("long");
    const ok = assembleJudgment(results, buildDecision("このまま待つほうが早く着きます。"), "ja");
    expect(session.checkJudgment(ok, results).errors).toEqual([]);
    expect(ok.typicalFlow).toBeUndefined();
    expect(ok.protection).toBe(true);

    for (const reason of [
      "人身事故はふつう1時間ほどで再開します。",
      "人身事故のよくある流れでは、まもなく再開します。",
      "人身事故は1時間ほどで再開します。",
      "いまは現場の対応の段階です。",
    ]) {
      const flowWording = assembleJudgment(results, buildDecision(reason), "ja");
      expect(session.checkJudgment(flowWording, results).errors.join("\n"), reason).toContain(
        "言い切る言い方",
      );
    }

    const made = assembleJudgment(
      results,
      buildDecision("人身事故は、再開まで3時間ほどです。"),
      "ja",
    );
    expect(session.checkJudgment(made, results).errors.join("\n")).toContain("3時間");
  });
});
