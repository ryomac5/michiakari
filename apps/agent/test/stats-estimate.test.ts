import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { addMinutesToIso, estimateStatsRemaining } from "@repo/core";
import type {
  IncidentCause,
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { models } from "../src/config.ts";
import { findFlowWording } from "../src/domain/flow-wording.ts";
import type { LlmClient } from "../src/llm-client.ts";
import { createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// 入口で答えた原因の統計値から、知見の無い原因の再開の見込みを出す
// 知見があれば知見、知見が無く統計値があれば統計値、どちらも無ければ見込みを持たない

const app = createTestApp();
// 2026-11-06 は金曜。12 時はそれ以外の時間帯、8 時台は通勤時間帯
const daytime = "2026-11-06T12:00:00+09:00";
const commute = "2026-11-06T08:40:00+09:00";
const signaling: IncidentCause = { group: "signaling", type: null };

function buildEntryObservation(now: string, elapsedMinutes: number): Observation {
  return {
    id: "entry-line",
    observedAt: addMinutesToIso(now, -elapsedMinutes),
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line: "JR神戸線",
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildRequest(input: {
  now?: string;
  elapsedMinutes?: number;
  cause?: IncidentCause;
  eventType?: string;
  statedResumeTime?: string;
}): JudgeRequest {
  const now = input.now ?? daytime;
  const observation = buildEntryObservation(now, input.elapsedMinutes ?? 0);
  return {
    observations: [{ ...observation, statedResumeTime: input.statedResumeTime ?? null }],
    newInput: input.eventType
      ? { type: "selection", eventType: input.eventType, signalIds: [] }
      : null,
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(input.cause ? { cause: input.cause } : {}),
  };
}

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

function expectNoResumeDuration(judgment: Judgment) {
  for (const text of [judgment.headline, judgment.reason ?? ""]) {
    expect(findFlowWording(text, "ja")).toBeNull();
  }
}

describe("見込みの出どころ", () => {
  it("知見のある原因は、原因を送っても知見から見込みを出す", async () => {
    const cause: IncidentCause = { group: "passenger", type: "person_collision" };
    const withCause = findJudgment(
      await postJudge(app, buildRequest({ eventType: "person_accident", cause })),
    );
    const without = findJudgment(
      await postJudge(app, buildRequest({ eventType: "person_accident" })),
    );
    expect(withCause.estimate.source).toBe("knowledge");
    expect(withCause.estimate.eventType).toBe("person_accident");
    expect(withCause.estimate.remaining).toEqual(without.estimate.remaining);
    const stats = estimateStatsRemaining(cause, daytime, daytime);
    expect(withCause.estimate.remaining).not.toEqual(stats?.remaining);
  });

  it("知見の無い大分類は、統計値から見込みと時刻ごとの再開の見込みを出す", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({ cause: signaling })));
    expect(judgment.estimate.source).toBe("statistics");
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.confidence).toBe("low");
    expect(judgment.estimate.remaining).toEqual(
      estimateStatsRemaining(signaling, daytime, daytime)?.remaining,
    );
    expect(judgment.breakEven?.resumeChance?.ticks.length).toBeGreaterThanOrEqual(4);
    expect(judgment.typicalFlow).toBeUndefined();
    expect(["hold", "switch"]).toContain(judgment.action);
    expectNoResumeDuration(judgment);
    expect(judgment.disclaimer).toContain("公式発表");
  });

  it("原因が分からなければ、見込みを持たず境目の時刻まで待つ", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({})));
    expect(judgment.estimate.source).toBe("none");
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.breakEven?.resumeChance).toBeUndefined();
    expect(judgment.action).toBe("hold");
  });

  it("統計値に無い大分類は、原因が分からないときと同じ流れにする", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ cause: { group: "not_in_stats", type: null } })),
    );
    expect(judgment.estimate.source).toBe("none");
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.action).toBe("hold");
  });

  it("発表の再開見込みがあれば、統計値より発表の時刻を使う", async () => {
    const stated = addMinutesToIso(daytime, 20);
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ cause: signaling, statedResumeTime: stated })),
    );
    expect(judgment.estimate.source).toBe("none");
    expect(judgment.estimate.remaining?.p50).toBe(20);
  });

  it("発生からの経過を差し引き、止まった時刻の時間帯で値を選ぶ", async () => {
    const elapsed = 30;
    const atCommute = findJudgment(
      await postJudge(
        app,
        buildRequest({ now: commute, elapsedMinutes: elapsed, cause: signaling }),
      ),
    );
    const onset = addMinutesToIso(commute, -elapsed);
    const expected = estimateStatsRemaining(signaling, onset, commute);
    expect(expected?.resolved.period).toBe("commute");
    expect(atCommute.estimate.remaining).toEqual(expected?.remaining);
    const atDaytime = findJudgment(
      await postJudge(app, buildRequest({ elapsedMinutes: elapsed, cause: signaling })),
    );
    expect(atDaytime.estimate.remaining).toEqual(
      estimateStatsRemaining(signaling, addMinutesToIso(daytime, -elapsed), daytime)?.remaining,
    );
    expect(atCommute.estimate.remaining).not.toEqual(atDaytime.estimate.remaining);
  });
});

describe("claude モードの統計値の見込み", () => {
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
  function replyWithTool(name: string, input: unknown): BetaMessage {
    seq += 1;
    return buildMessage([{ type: "tool_use", id: `toolu_stats_${seq}`, name, input }], "tool_use");
  }

  const holdDecision = {
    action: "hold",
    headline: "いまは待ち、動かなければ切り替え",
    reason: "境目を過ぎると代わりの手段のほうが早く着きます。",
    breakEvenExplanation: "境目までに再開しなければ代わりの手段のほうが早く着きます",
    recommendedOptionId: null,
    evidence: [{ kind: "computation", id: "remaining", description: "再開の見込み" }],
  };

  // Claude が estimate_phase_and_remaining に eventType を渡す台本で判断する
  async function judgeWithClaude(request: JudgeRequest, eventType: string | null) {
    const calls: MessageCreateParamsNonStreaming[] = [];
    const script = [
      replyWithTool("estimate_phase_and_remaining", { eventType }),
      replyWithTool("find_alternatives", {}),
      replyWithTool("compute_break_even", {}),
      replyWithTool("emit_judgment", holdDecision),
    ];
    const llm: LlmClient = {
      async createMessage(params) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const reply = script.shift();
        if (!reply) throw new Error("台本が尽きました");
        return reply;
      },
    };
    const deps = createTestDeps({ mode: "claude", llm });
    const judgment = findJudgment(await postJudge(createTestApp(deps), request));
    // 決定論への切り替えでなく、Claude の判断が確定している
    expect(judgment.headline).toBe(holdDecision.headline);
    expect(script).toHaveLength(0);
    return { judgment, calls };
  }

  it("決定論モードと同じ見込みを使い、原因を Claude に渡す", async () => {
    const request = buildRequest({ cause: signaling });
    const { judgment: claude, calls } = await judgeWithClaude(request, null);
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate).toEqual(deterministic.estimate);
    expect(claude.estimate.source).toBe("statistics");
    const firstUser = JSON.stringify(calls[0]?.messages[0]?.content ?? "");
    expect(firstUser).toContain("signaling");
  });

  it("観測に無い知見を Claude が指定しても、コードが決めた事象で統計値の見込みを出す", async () => {
    const request = buildRequest({ cause: signaling });
    const { judgment: claude } = await judgeWithClaude(request, "person_accident");
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBeNull();
    expect(claude.estimate.source).toBe("statistics");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });

  it("観測で決まった知見を Claude が null にしても、その知見で見込みを出す", async () => {
    const request = buildRequest({
      eventType: "person_accident",
      cause: { group: "passenger", type: "person_collision" },
    });
    const { judgment: claude } = await judgeWithClaude(request, null);
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBe("person_accident");
    expect(claude.estimate.source).toBe("knowledge");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });

  it("観測と違う知見を Claude が指定しても、観測で決まった知見を使う", async () => {
    const request = buildRequest({ eventType: "person_accident" });
    const { judgment: claude } = await judgeWithClaude(request, "vehicle_failure");
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBe("person_accident");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });
});
