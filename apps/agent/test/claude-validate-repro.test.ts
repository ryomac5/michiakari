import type { Evidence, JudgeRequest, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { assembleJudgment } from "../src/judge/assemble.ts";
import { formatValidationFailure } from "../src/judge/claude-judge.ts";
import { decideDeterministically } from "../src/judge/deterministic-decision.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession, type JudgeSession } from "../src/judge/session.ts";
import { loadPrompts } from "../src/prompts/load-prompts.ts";
import type { Decision } from "../src/tools/emit-judgment.ts";
import { createTestDeps } from "./helpers.ts";

// claude モードの判断が検証に 2 回続けて落ちた件の再現。ツールは今の形のまま動かし、
// prompt の指示に素直に従った Claude の出力を固定の JSON で渡して、検証だけを確かめる

const deps = createTestDeps();
const now = "2026-11-05T22:00:00+09:00";

const entryLine: Observation = {
  id: "entry-line",
  observedAt: "2026-11-05T21:50:00+09:00",
  source: "selection",
  kind: "station_broadcast",
  eventTypeCandidates: [],
  operator: "JR西日本",
  line: "JR神戸線",
  section: null,
  statedResumeTime: null,
  transferServiceActive: null,
  detectedSignals: [],
};
// 入口で受信の放送を聞いたと答えた人の観測。画面が送る形と同じ
const protectionHeard: Observation = {
  ...entryLine,
  id: "entry-protection-broadcast",
  operator: null,
  line: null,
  rawText: "危険を知らせる信号を受信したため、緊急停止しました",
};
// 入口で人身事故を選んだ観測。選択なので原文が無い
const personSelected: Observation = {
  ...entryLine,
  id: "obs_1",
  eventTypeCandidates: [{ eventType: "person_collision", confidence: "high" }],
};
const evacuation: Observation = {
  ...entryLine,
  id: "obs_2",
  kind: "station_broadcast",
  rawText: "係員の案内で線路に降りて、最寄りの駅まで歩いて移動します。",
  detectedSignals: [
    {
      eventType: "person_collision",
      signalId: "evacuation_on_track",
      quote: "係員の案内で線路に降りて、最寄りの駅まで歩いて移動します。",
    },
  ],
};

const betweenStations = {
  kind: "between_stations" as const,
  nextStation: "塚本",
  previousStation: "大阪",
  trainsAhead: null,
  trainsAheadCount: null,
  ownTrainType: "local" as const,
  trainsAheadHeadwayMinutes: null,
};

function buildRequest(overrides: Partial<JudgeRequest>): JudgeRequest {
  return {
    observations: [],
    newInput: null,
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...overrides,
  };
}

type ToolRun = {
  session: JudgeSession;
  // compute_break_even が Claude に返した根拠の一覧
  evidenceChoices: Evidence[];
};

// Claude と同じ順にツールを呼ぶ。返る内容は Claude に渡すものと同じ
async function runTools(request: JudgeRequest): Promise<ToolRun> {
  const session = createJudgeSession(
    {
      request,
      observations: request.observations,
      content: deps.content,
      provider: deps.provider,
      scenario: null,
      fetchRain: deps.fetchRain,
    },
    createEventSink(
      async () => {},
      () => now,
    ),
  );
  await session.executeTool("estimate_remaining", { eventType: session.inferredEventType });
  await session.executeTool("find_alternatives", {});
  const breakEven = await session.executeTool("compute_break_even", {});
  const content = breakEven.content as { evidenceChoices?: Evidence[] };
  return { session, evidenceChoices: content.evidenceChoices ?? [] };
}

function checkDecision(run: ToolRun, decision: Decision) {
  const { estimate, alternatives, breakEven } = run.session.state;
  if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
  const results = { estimate, alternatives, breakEven };
  const language = run.session.ctx.request.language;
  return run.session.checkJudgment(
    assembleJudgment(results, decision, language, run.session.buildInCarGuide(results)),
    results,
  );
}

const pickChoices = (choices: Evidence[], ...ids: string[]) =>
  choices.filter((c) => ids.includes(c.id));

describe("claude モードの素直な出力が検証に通る", () => {
  it("電車の中、駅と駅の間、原因は分からない", async () => {
    const run = await runTools(
      buildRequest({
        observations: [entryLine],
        trainPosition: betweenStations,
        protectionBroadcast: "not_heard",
      }),
    );
    // 原因も再開の見込みも無く、駅の間では比較と境目も根拠に出ない。根拠に挙げてよい項目は無い
    expect(run.evidenceChoices).toEqual([]);
    const decision: Decision = {
      action: "wait",
      headline: "車内で待つ",
      reason: "列車が動くまで、車内で待ってください。",
      breakEvenExplanation:
        "22時14分までに再開すれば22時55分着の阪神本線経由より待つほうが早く着きます。",
      recommendedOptionId: null,
      evidence: [],
    };
    expect(checkDecision(run, decision).errors).toEqual([]);

    // 改める前の prompt は再開の見込みの根拠を挙げてよいと読めた。一覧に無い根拠は落ち、指摘に一覧が付く
    const before = checkDecision(run, {
      ...decision,
      evidence: [{ kind: "computation", id: "remaining", description: "再開の見込みです。" }],
    });
    expect(before.issues.map((i) => i.check)).toEqual(["evidence_ref"]);
    expect(before.errors[0]).toContain("evidenceChoices");
    expect(before.errors[0]).toContain("空の配列");
  });

  it("駅にいて、人身事故", async () => {
    const run = await runTools(
      buildRequest({
        observations: [entryLine, personSelected],
        cause: { group: "passenger", type: "person_collision" },
      }),
    );
    // 選んだ原因には発表の引用が無いので、signal の根拠は一覧に無い
    expect(run.evidenceChoices.some((c) => c.kind === "signal")).toBe(false);
    const decision: Decision = {
      action: "switch",
      headline: "大阪梅田まで歩いて阪神本線へ",
      reason:
        "待つより阪神本線のほうが早く着きます。再開は23時16分ごろの見込みです。遅めに見ると、0時00分までに動く見込みは9割です。",
      breakEvenExplanation:
        "22時14分までに再開すれば22時55分着の阪神本線経由より待つほうが早く着きます。",
      recommendedOptionId: "transfer_1",
      evidence: pickChoices(run.evidenceChoices, "break_even", "unaffected_track"),
    };
    expect(decision.evidence).toHaveLength(2);
    expect(checkDecision(run, decision).errors).toEqual([]);

    const before = checkDecision(run, {
      ...decision,
      evidence: [{ kind: "signal", id: "person_collision", description: "人身事故の発表です。" }],
    });
    expect(before.issues.map((i) => i.check)).toEqual(["evidence_ref"]);
    expect(before.errors[0]).toContain("computation/break_even");
  });

  it("電車の中、駅と駅の間、受信の放送あり", async () => {
    const run = await runTools(
      buildRequest({
        observations: [entryLine, protectionHeard],
        trainPosition: betweenStations,
        protectionBroadcast: "heard",
      }),
    );
    expect(run.session.state.estimate?.stopReasons?.mostLikely).toBe("protection_received");
    expect(run.evidenceChoices.map((c) => `${c.kind}/${c.id}`)).toEqual([
      "cue/protection_received",
      "computation/unaffected_track",
    ]);
    const decision: Decision = {
      action: "wait",
      headline: "車内で待つ",
      reason:
        "列車が動くまで、車内で待ってください。反対の線路は22時00分ごろから先に動くことがあります。",
      breakEvenExplanation:
        "22時14分までに再開すれば22時55分着の阪神本線経由より待つほうが早く着きます。",
      recommendedOptionId: null,
      evidence: run.evidenceChoices,
    };
    expect(checkDecision(run, decision).errors).toEqual([]);

    const before = checkDecision(run, {
      ...decision,
      evidence: [
        ...run.evidenceChoices,
        { kind: "computation", id: "break_even", description: "境目を計算しました。" },
      ],
    });
    expect(before.issues.map((i) => i.check)).toEqual(["evidence_ref"]);
  });

  it("電車の中、駅と駅の間、線路に降りる案内", async () => {
    const run = await runTools(
      buildRequest({
        observations: [entryLine, personSelected, evacuation],
        trainPosition: betweenStations,
        cause: { group: "passenger", type: "person_collision" },
      }),
    );
    expect(run.session.state.estimate?.cues).toContain("evacuation_on_track");
    const decision: Decision = {
      action: "wait",
      headline: "係員の案内に従う",
      reason: "線路に降りる案内が出ています。",
      breakEvenExplanation: "",
      recommendedOptionId: null,
      evidence: pickChoices(run.evidenceChoices, "evacuation_on_track"),
    };
    expect(decision.evidence).toHaveLength(1);
    expect(checkDecision(run, decision).errors).toEqual([]);
    // 改める前の prompt は線路に降りる案内で hold を求めていた。駅の間の車内では検証が wait を求める
    const hold = checkDecision(run, { ...decision, action: "hold" });
    expect(hold.issues.map((i) => i.check)).toContain("refs");
  });

  it("英語で線路に降りる案内が出ても、決定論モードの理由が検証に通る", async () => {
    const run = await runTools(
      buildRequest({
        observations: [entryLine, personSelected, evacuation],
        cause: { group: "passenger", type: "person_collision" },
        language: "en",
      }),
    );
    const { estimate, alternatives, breakEven } = run.session.state;
    if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
    const decision = decideDeterministically(run.session, { estimate, alternatives, breakEven });
    expect(checkDecision(run, decision).errors).toEqual([]);
  });
});

describe("検証の失敗の記録とプロンプト", () => {
  it("落ちた検査の名前と指摘、判断の文の抜粋を 200 字までに切って出し、キーを伏せる", () => {
    const line = formatValidationFailure(
      2,
      [{ check: "evidence_ref", message: "根拠がツールの結果にありません: signal/x" }],
      {
        action: "switch",
        headline: "阪神本線に乗り換える",
        reason: `sk-ant-abc123 ${"あ".repeat(300)}`,
        evidence: [{ kind: "signal", id: "x", description: "d" }],
      },
    );
    expect(line).toContain("2 回目");
    expect(line).toContain("[evidence_ref]");
    expect(line).toContain("evidence=signal/x");
    expect(line).not.toContain("abc123");
    const reason = /reason=「([^」]*)」/.exec(line)?.[1] ?? "";
    expect(reason.length).toBeLessThanOrEqual(200);
  });

  it("判断の指示は、根拠を evidenceChoices から選ぶよう求める", () => {
    const prompt = loadPrompts().judgmentSystem;
    expect(prompt).toContain("evidenceChoices");
    expect(prompt).not.toContain("`remaining`・`alternatives`・`break_even`");
  });
});
