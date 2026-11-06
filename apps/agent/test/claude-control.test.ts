import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { claudeSettings, models } from "../src/config.ts";
import type { Interpretation } from "../src/interpret/claude-interpret.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { runJudge } from "../src/judge/run-judge.ts";
import type { LlmClient } from "../src/llm-client.ts";
import {
  buildScenarioRequest,
  createTestApp,
  createTestDeps,
  parseSseEvents,
  postJudge,
} from "./helpers.ts";

// claude モードの制御: 切断時の中断、反復の上限、解釈の失敗、進捗に流す内容

const baseDeps = createTestDeps();
const scenario = [...baseDeps.content.scenarios.values()][0];
const entry = scenario?.timeline[0];
const knowledge = scenario ? baseDeps.content.knowledge.get(scenario.event_type) : undefined;
if (!scenario || !entry || !knowledge) throw new Error("開発用の知見とシナリオが必要です");

const textRequest = {
  ...buildScenarioRequest(scenario, entry, []),
  newInput: { type: "text" as const, text: entry.text.ja },
};

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

let seq = 0;
function replyWithTool(name: string, input: unknown, extra: unknown[] = []): BetaMessage {
  seq += 1;
  return buildMessage(
    [...extra, { type: "tool_use", id: `toolu_c${seq}`, name, input }],
    "tool_use",
  );
}

const interpretation: Interpretation = {
  kind: "announcement",
  rawText: entry.text.ja,
  eventTypeCandidates: [{ eventType: knowledge.id, confidence: "high" }],
  operator: null,
  line: null,
  section: null,
  statedResumeClock: null,
  transferServiceActive: null,
  detectedSignals: [],
};
const interpretationReply = buildMessage(
  [{ type: "text", text: JSON.stringify(interpretation) }],
  "end_turn",
);

function collectSink() {
  const events: JudgmentEvent[] = [];
  const sink = createEventSink(
    async (e) => {
      events.push(e);
    },
    () => textRequest.now,
  );
  return { events, sink };
}

describe("切断時の中断", () => {
  it("signal が中断されたら Opus のループを止め、判断も error も送らない", async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    let judgeCalls = 0;
    const llm: LlmClient = {
      async createMessage(params, options) {
        signals.push(options?.signal);
        if (params.model === models.interpretation) return interpretationReply;
        judgeCalls += 1;
        // 2 回目の呼び出しの最中に利用者が切断した
        if (judgeCalls === 2) controller.abort();
        return replyWithTool("lookup_knowledge", { eventType: knowledge?.id });
      },
    };
    const { events, sink } = collectSink();
    await runJudge(
      textRequest,
      { scenarioId: null, signal: controller.signal },
      createTestDeps({ mode: "claude", llm }),
      sink,
    );
    expect(judgeCalls).toBe(2);
    expect(signals.every((s) => s === controller.signal)).toBe(true);
    expect(events.some((e) => e.type === "judgment_ready" || e.type === "error")).toBe(false);
  });

  it("SSE の読み手が切断すると、サーバー側のループも止まる", async () => {
    let judgeCalls = 0;
    const llm: LlmClient = {
      async createMessage(params, options) {
        if (params.model === models.interpretation) return interpretationReply;
        judgeCalls += 1;
        // 応答に時間がかかる Claude を模す。切断されたら中断のエラーにする
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 30);
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return replyWithTool("lookup_knowledge", { eventType: knowledge?.id });
      },
    };
    const app = createTestApp(createTestDeps({ mode: "claude", llm }));
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(textRequest),
    });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("本文がありません");
    await reader.read();
    await reader.cancel();
    const callsAtCancel = judgeCalls;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(judgeCalls).toBeLessThanOrEqual(callsAtCancel + 1);
    expect(judgeCalls).toBeLessThan(claudeSettings.maxToolCalls);
  });
});

describe("判断ループの反復の上限", () => {
  it("ツールを呼ばない応答が続いても、上限で止めて決定論モードで仕上げる", async () => {
    let judgeCalls = 0;
    const llm: LlmClient = {
      async createMessage(params) {
        if (params.model === models.interpretation) return interpretationReply;
        judgeCalls += 1;
        return buildMessage([{ type: "text", text: "考えています" }], "pause_turn");
      },
    };
    const warnings: string[] = [];
    const events = await postJudge(
      createTestApp(createTestDeps({ mode: "claude", llm, logWarning: (m) => warnings.push(m) })),
      textRequest,
    );
    expect(judgeCalls).toBe(claudeSettings.maxLoopIterations);
    expect(warnings.some((w) => w.includes("反復"))).toBe(true);
    expect(events.some((e) => e.type === "judgment_ready")).toBe(true);
  });
});

describe("解釈の失敗", () => {
  it("claude モードで写真を読めなければ、再試行を促す error を送る", async () => {
    const llm: LlmClient = {
      async createMessage() {
        throw new Error("overloaded");
      },
    };
    const res = await createTestApp(createTestDeps({ mode: "claude", llm })).request("/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...textRequest,
        newInput: { type: "photo", imageBase64: "aGVsbG8=", mediaType: "image/png" },
      }),
    });
    const error = parseSseEvents(await res.text()).find((e) => e.type === "error");
    expect(error).toMatchObject({
      retryable: true,
      message: "読み取れませんでした。もう一度試すか、文章で入力してください。",
    });
  });
});

describe("進捗に流す内容", () => {
  it("text ブロックと進捗メモを流し、ツールの入力は流さない", async () => {
    const replies = [
      replyWithTool("lookup_knowledge", { eventType: knowledge.id }, [
        { type: "thinking", thinking: "知見の段階を見比べています", signature: "sig" },
        { type: "text", text: "知見を確かめます" },
      ]),
    ];
    const llm: LlmClient = {
      async createMessage(params) {
        if (params.model === models.interpretation) return interpretationReply;
        const reply = replies.shift();
        if (!reply) throw new Error("台本が尽きました");
        return reply;
      },
    };
    const events = await postJudge(
      createTestApp(createTestDeps({ mode: "claude", llm })),
      textRequest,
    );
    const notes = events.flatMap((e) => (e.type === "progress" && !e.stage ? [e.message] : []));
    expect(claudeSettings.thinkingDisplay).toBe("updates");
    expect(notes).toEqual(["知見の段階を見比べています", "知見を確かめます"]);
  });
});
