import type {
  BetaMessage,
  BetaTextBlockParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { claudeSettings, models } from "../src/config.ts";
import type { Interpretation } from "../src/interpret/claude-interpret.ts";
import type { LlmClient } from "../src/llm-client.ts";
import { buildScenarioRequest, createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// claude モードを Anthropic クライアントの偽物で動かし、ツールループ・再生成・フォールバックを確かめる

const baseDeps = createTestDeps();
const scenario = [...baseDeps.content.scenarios.values()][0];
const entry = scenario?.timeline[0];
const knowledge = scenario ? baseDeps.content.knowledge.get(scenario.event_type) : undefined;
const signal = knowledge?.phases[0]?.signals[0];
if (!scenario || !entry || !knowledge || !signal)
  throw new Error("開発用の知見とシナリオが必要です");

const USER_TEXT = entry.text.ja;
const request = {
  ...buildScenarioRequest(scenario, entry, []),
  newInput: { type: "text" as const, text: USER_TEXT },
};

const ORDER: JudgmentEvent["type"][] = [
  "observation_parsed",
  "signal_detected",
  "phase_estimated",
  "alternatives_computed",
  "break_even_computed",
  "judgment_ready",
];

type Reply = BetaMessage | Error;

function buildMessage(content: unknown[], stopReason: string): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: models.judgment,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as BetaMessage;
}

let toolUseSeq = 0;
function replyWithTool(name: string, input: unknown, text?: string): BetaMessage {
  toolUseSeq += 1;
  const blocks = [
    ...(text ? [{ type: "text", text }] : []),
    { type: "tool_use", id: `toolu_${toolUseSeq}`, name, input },
  ];
  return buildMessage(blocks, "tool_use");
}

const interpretation: Interpretation = {
  kind: "announcement",
  rawText: USER_TEXT,
  eventTypeCandidates: [{ eventType: knowledge.id, confidence: "high" }],
  operator: null,
  line: null,
  section: null,
  statedResumeClock: null,
  transferServiceActive: null,
  detectedSignals: [{ eventType: knowledge.id, signalId: signal.id, quote: USER_TEXT }],
};

const validDecision = {
  action: "hold",
  headline: "判断を保留します",
  breakEvenExplanation: "分岐点までに再開しなければ代替手段のほうが早く着きます",
  recommendedOptionId: null,
  evidence: [{ kind: "knowledge", id: knowledge.id, description: "知見の要約" }],
};

const invalidDecision = {
  ...validDecision,
  evidence: [{ kind: "signal", id: "made_up_signal", description: "作り話" }],
};

function buildToolSequence(): Reply[] {
  return [
    replyWithTool("lookup_knowledge", { eventType: knowledge?.id }, "知見を確かめます"),
    replyWithTool("estimate_phase_and_remaining", { eventType: knowledge?.id }),
    replyWithTool("find_alternatives", {}),
    replyWithTool("compute_break_even", {}),
  ];
}

function createScriptedLlm(options: { interpretation?: Reply; judgment: Reply[] }) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const judgment = [...options.judgment];
  const llm: LlmClient = {
    async createMessage(params) {
      calls.push(JSON.parse(JSON.stringify(params)));
      const reply =
        params.model === models.interpretation
          ? (options.interpretation ??
            buildMessage([{ type: "text", text: JSON.stringify(interpretation) }], "end_turn"))
          : judgment.shift();
      if (!reply) throw new Error("台本が尽きました");
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { llm, calls };
}

async function runWith(script: ReturnType<typeof createScriptedLlm>) {
  const warnings: string[] = [];
  const deps = createTestDeps({
    mode: "claude",
    llm: script.llm,
    logWarning: (m) => warnings.push(m),
  });
  const events = await postJudge(createTestApp(deps), request);
  const ready = events.find((e) => e.type === "judgment_ready");
  return { events, warnings, judgment: ready?.type === "judgment_ready" ? ready.judgment : null };
}

function collapseTypes(events: JudgmentEvent[]): string[] {
  return events.map((e) => e.type).filter((t, i, all) => t !== all[i - 1]);
}

function countType(events: JudgmentEvent[], type: JudgmentEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

describe("claude モード", () => {
  it("ツールループを回し、Claude の決定とツールの数値で判断を組み立てる", async () => {
    const script = createScriptedLlm({
      judgment: [...buildToolSequence(), replyWithTool("emit_judgment", validDecision)],
    });
    const { events, judgment, warnings } = await runWith(script);

    expect(warnings).toEqual([]);
    expect(collapseTypes(events)).toEqual(ORDER);
    expect(judgment?.headline).toBe(validDecision.headline);
    const estimated = events.find((e) => e.type === "phase_estimated");
    expect(judgment?.estimate).toEqual(
      estimated?.type === "phase_estimated" ? estimated.estimate : null,
    );

    const [interpretCall, ...judgeCalls] = script.calls;
    expect(interpretCall?.model).toBe(models.interpretation);
    expect(interpretCall?.output_config?.format).toBeDefined();
    expect(judgeCalls).toHaveLength(5);

    const first = judgeCalls[0];
    if (!first) throw new Error("判断の呼び出しがありません");
    expect(first.model).toBe(models.judgment);
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.fallbacks).toBe("default");
    expect(first.betas).toContain(claudeSettings.fallbackBeta);
    expect(first.tools?.map((t) => ("name" in t ? t.name : ""))).toContain("emit_judgment");

    // 知見はキャッシュできるブロックで、利用者の入力はシステムプロンプトに混ぜない
    const system = first.system as BetaTextBlockParam[];
    expect(system[1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(system.some((b) => b.text.includes(USER_TEXT))).toBe(false);
    const userMessage = first.messages[0];
    expect(
      typeof userMessage?.content === "string" && userMessage.content.includes("<observations>"),
    ).toBe(true);

    // ツールの結果を同じ順で返している
    const second = judgeCalls[1];
    const toolResult = second?.messages.at(-1);
    expect(toolResult?.role).toBe("user");
    expect(JSON.stringify(toolResult?.content)).toContain("tool_result");
  });

  it("emit_judgment の検証に失敗したら、指摘を返して 1 回だけ再生成させる", async () => {
    const script = createScriptedLlm({
      judgment: [
        ...buildToolSequence(),
        replyWithTool("emit_judgment", invalidDecision),
        replyWithTool("emit_judgment", validDecision),
      ],
    });
    const { events, judgment, warnings } = await runWith(script);
    expect(warnings).toEqual([]);
    expect(judgment?.headline).toBe(validDecision.headline);
    expect(collapseTypes(events)).toEqual(ORDER);
    const retryCall = script.calls.at(-1);
    const feedback = JSON.stringify(retryCall?.messages.at(-1)?.content);
    expect(feedback).toContain('"is_error":true');
    expect(feedback).toContain("made_up_signal");
  });

  it("再生成でも検証に通らなければ、決定論モードで仕上げる", async () => {
    const script = createScriptedLlm({
      judgment: [
        ...buildToolSequence(),
        replyWithTool("emit_judgment", invalidDecision),
        replyWithTool("emit_judgment", invalidDecision),
      ],
    });
    const { events, judgment, warnings } = await runWith(script);
    expect(warnings.some((w) => w.includes("決定論モード"))).toBe(true);
    expect(judgment).not.toBeNull();
    expect(judgment?.headline).not.toBe(validDecision.headline);
    expect(collapseTypes(events)).toEqual(ORDER);
    expect(countType(events, "phase_estimated")).toBe(1);
  });

  it("API の失敗では、済んだツールを生かして決定論モードで仕上げる", async () => {
    const script = createScriptedLlm({
      judgment: [...buildToolSequence().slice(0, 2), new Error("overloaded")],
    });
    const { events, judgment, warnings } = await runWith(script);
    expect(warnings.some((w) => w.includes("決定論モード"))).toBe(true);
    expect(judgment).not.toBeNull();
    expect(collapseTypes(events)).toEqual(ORDER);
    expect(countType(events, "phase_estimated")).toBe(1);
    expect(countType(events, "alternatives_computed")).toBe(1);
  });

  it("拒否で止まったら決定論モードで仕上げる", async () => {
    const script = createScriptedLlm({ judgment: [buildMessage([], "refusal")] });
    const { events, judgment } = await runWith(script);
    expect(judgment).not.toBeNull();
    expect(collapseTypes(events)).toEqual(ORDER);
  });

  it("ツール呼び出しの上限を超えたら決定論モードで仕上げる", async () => {
    const loop = Array.from({ length: claudeSettings.maxToolCalls + 1 }, () =>
      replyWithTool("lookup_knowledge", { eventType: knowledge?.id }),
    );
    const script = createScriptedLlm({ judgment: loop });
    const { judgment, warnings } = await runWith(script);
    expect(warnings.some((w) => w.includes("上限"))).toBe(true);
    expect(judgment).not.toBeNull();
  });

  it("解釈に失敗したら、文字列照合で解釈して続ける", async () => {
    const script = createScriptedLlm({
      interpretation: new Error("timeout"),
      judgment: [...buildToolSequence(), replyWithTool("emit_judgment", validDecision)],
    });
    const { events, judgment, warnings } = await runWith(script);
    expect(warnings.some((w) => w.includes("解釈"))).toBe(true);
    expect(events[0]?.type).toBe("observation_parsed");
    expect(judgment?.headline).toBe(validDecision.headline);
  });
});
