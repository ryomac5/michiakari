import type { JudgeRequest, Judgment, JudgmentEvent, Lang, TypicalFlow } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { decisionParams } from "../src/config.ts";
import {
  buildFlowSentence,
  classifyFlowOutlook,
  formatDuration,
} from "../src/domain/typical-flow.ts";
import { assembleJudgment } from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import { createTestApp, createTestDeps, postJudge, replayScenario } from "./helpers.ts";

// 判断に載るよくある流れと、それを使った結論の言葉。決定論モードとダミーの知見で確かめる

const deps = createTestDeps();
const app = createTestApp(deps);

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

// 入口の「放送で何と言っていましたか」で原因を選んだときと同じ形の要求
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

describe("判断のよくある流れ", () => {
  it("人身事故の判断に、知見から求めたよくある流れが入る", async () => {
    const scenario = deps.content.scenarios.get("person_accident_last_train");
    if (!scenario) throw new Error("ダミーのシナリオがありません");
    const [first] = await replayScenario(app, {
      ...scenario,
      timeline: scenario.timeline.slice(0, 1),
    });
    const judgment = findJudgment(first?.events ?? []);
    expect(judgment.typicalFlow).toMatchObject({
      eventType: "person_accident",
      predictability: { level: "high", source: "knowledge" },
      typicalFloorMinutes: 60,
    });
    expect(judgment.typicalFlow?.phases.map((p) => p.id)).toEqual([
      "initial",
      "on_site_response",
      "resume_estimate",
      "preparing_resume",
    ]);
    // 見込みが立てやすい事象なので、理由の頭で流れを伝える
    expect(judgment.reason).toMatch(/^人身事故は、再開まで1時間ほどかかるのがふつうです。/);
  });

  it("原因が分からない判断には、よくある流れを入れない", async () => {
    const judgment = findJudgment(await postJudge(app, buildSelectionRequest(null)));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.typicalFlow).toBeUndefined();
  });

  it("入口で車内対応を選ぶと、止まった直後でも待つと言い切り、安心させる言葉を使う", async () => {
    const judgment = findJudgment(await postJudge(app, buildSelectionRequest("in_car_response")));
    expect(judgment.estimate.confidence).toBe("low");
    expect(judgment.action).toBe("wait");
    expect(judgment.headline).toBe("慌てず、このまま待ちましょう");
    expect(judgment.reason).toMatch(/^車内対応は5〜10分ほどで終わることが多いです。/);
    expect(judgment.typicalFlow?.untilResume).toEqual({ p50: 5, p80: 10 });
  });

  it("英語でも同じ方針で、数値の検査を通る", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildSelectionRequest("in_car_response", "en")),
    );
    expect(judgment.action).toBe("wait");
    expect(judgment.headline).toBe("No need to rush. Stay and wait.");
    expect(judgment.reason).toContain("Onboard assistance: usually over in about 5–10 min.");
  });
});

describe("claude モードの数値の検査", () => {
  // 入口で人身事故を選んだ場面のセッションを作り、ツールを順に呼ぶ
  async function prepareSession() {
    const request = buildSelectionRequest("person_accident");
    const observation = {
      id: "obs_1",
      observedAt: request.now,
      source: "selection" as const,
      eventTypeCandidates: [{ eventType: "person_accident", confidence: "high" as const }],
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
    await session.executeTool("estimate_phase_and_remaining", { eventType: "person_accident" });
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

  it("ツールが返した流れの一文は通り、知見に無い時間は指摘する", async () => {
    const { session, results } = await prepareSession();
    expect(results.estimate.flowOutlook).toBe("long");
    const sentence = results.estimate.flowSentence ?? "";
    expect(sentence).toBe("人身事故は、再開まで1時間ほどかかるのがふつうです。");
    const ok = assembleJudgment(results, buildDecision(sentence), "ja");
    expect(session.checkJudgment(ok, results).errors).toEqual([]);
    expect(ok.typicalFlow?.eventType).toBe("person_accident");

    const made = assembleJudgment(
      results,
      buildDecision("人身事故は、再開まで3時間ほどです。"),
      "ja",
    );
    expect(session.checkJudgment(made, results).errors.join("\n")).toContain("3時間");
  });
});

describe("よくある流れの言葉", () => {
  const base: Omit<TypicalFlow, "untilResume" | "predictability"> = {
    eventType: "x",
    phases: [{ id: "a", name: { ja: "a" }, duration: { p50: 1, p80: 2 } }],
    firstTrainWait: { p50: 0, p80: 0 },
    typicalFloorMinutes: null,
  };
  const high = { level: "high", source: "knowledge", basis: null } as const;

  it("見込みが立てやすく p80 が短ければ short、長ければ long、立てにくければ null", () => {
    const short = decisionParams.shortFlowMaxMinutes;
    expect(
      classifyFlowOutlook({
        ...base,
        untilResume: { p50: 5, p80: short },
        predictability: high,
      }),
    ).toBe("short");
    expect(
      classifyFlowOutlook({
        ...base,
        untilResume: { p50: 5, p80: short + 1 },
        predictability: high,
      }),
    ).toBe("long");
    expect(
      classifyFlowOutlook({
        ...base,
        untilResume: { p50: 5, p80: 10 },
        predictability: { ...high, level: "medium" },
      }),
    ).toBeNull();
    expect(classifyFlowOutlook(null)).toBeNull();
  });

  it("目安の分を時間と分で書く", () => {
    expect(formatDuration(60, "ja")).toBe("1時間");
    expect(formatDuration(90, "ja")).toBe("1時間30分");
    expect(formatDuration(45, "ja")).toBe("45分");
    expect(formatDuration(120, "en")).toBe("2 hours");
    expect(formatDuration(90, "en")).toBe("90 min");
  });

  it("長くかかる事象は下限を、無ければ再開までの p50 を使う", () => {
    const flow = { ...base, untilResume: { p50: 70, p80: 110 }, predictability: high };
    expect(buildFlowSentence({ ...flow, typicalFloorMinutes: 60 }, "人身事故", "long", "ja")).toBe(
      "人身事故は、再開まで1時間ほどかかるのがふつうです。",
    );
    expect(buildFlowSentence(flow, "人身事故", "long", "ja")).toBe(
      "人身事故は、再開まで1時間10分ほどかかるのがふつうです。",
    );
  });
});
