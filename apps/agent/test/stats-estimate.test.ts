import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { addMinutesToIso, estimateStatsRemaining, resolveFirstTrainWait } from "@repo/core";
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
import { runEstimateRemaining } from "../src/tools/estimate-remaining.ts";
import type { ToolContext } from "../src/tools/types.ts";
import { createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// 入口で答えた原因の統計値から、再開の見込みを出す
// 種類が分かれば規則表と種類の統計値、大分類だけなら大分類の統計値、どちらも無ければ見込みを持たない
// 乗れるまでの残りは、再開までの統計値に規則表の初列車待ちを足したもの

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

// 大分類だけのときの初列車待ちは、区間が止まるものとみなした値
const sectionWait = resolveFirstTrainWait(null);

// 再開までの統計値に初列車待ちを足した、乗れるまでの残り
function expectStatsBoardable(cause: IncidentCause, onset: string, now: string) {
  const stats = estimateStatsRemaining(cause, onset, now);
  if (!stats) throw new Error("統計値が要ります");
  return {
    p50: stats.remaining.p50 + sectionWait.p50,
    p80: stats.remaining.p80 + sectionWait.p80,
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
  it("種類が分かれば、原因を送っても送らなくても規則表の種類で同じ見込みを出す", async () => {
    const cause: IncidentCause = { group: "passenger", type: "person_collision" };
    const withCause = findJudgment(
      await postJudge(app, buildRequest({ eventType: "person_collision", cause })),
    );
    const without = findJudgment(
      await postJudge(app, buildRequest({ eventType: "person_collision" })),
    );
    expect(withCause.estimate.source).toBe("rule");
    expect(withCause.estimate.eventType).toBe("person_collision");
    expect(withCause.estimate.remaining).toEqual(without.estimate.remaining);
    expect(withCause.estimate.remaining).toEqual(expectStatsBoardable(cause, daytime, daytime));
  });

  it("選択式で大分類の id を送ると、大分類の統計値で見込む", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({ eventType: "signaling" })));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.source).toBe("statistics");
    expect(judgment.estimate.remaining).toEqual(expectStatsBoardable(signaling, daytime, daytime));
  });

  it("大分類だけの原因は、統計値から見込みと時刻ごとの再開の見込みを出す", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({ cause: signaling })));
    expect(judgment.estimate.source).toBe("statistics");
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.confidence).toBe("low");
    expect(judgment.estimate.remaining).toEqual(expectStatsBoardable(signaling, daytime, daytime));
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
    // 出どころは原因の見込みの元を指すので、発表の時刻を使っても統計値のまま
    expect(judgment.estimate.source).toBe("statistics");
    expect(judgment.estimate.remaining?.p50).toBe(20 + sectionWait.p50);
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
    expect(estimateStatsRemaining(signaling, onset, commute)?.resolved.period).toBe("commute");
    expect(atCommute.estimate.remaining).toEqual(expectStatsBoardable(signaling, onset, commute));
    const atDaytime = findJudgment(
      await postJudge(app, buildRequest({ elapsedMinutes: elapsed, cause: signaling })),
    );
    expect(atDaytime.estimate.remaining).toEqual(
      expectStatsBoardable(signaling, addMinutesToIso(daytime, -elapsed), daytime),
    );
    expect(atCommute.estimate.remaining).not.toEqual(atDaytime.estimate.remaining);
  });
});

describe("放送の再開時刻の前後", () => {
  const deps = createTestDeps();
  const stated = "2026-11-06T12:30:00+09:00";

  // 止まって 20 分後に放送の時刻を聞いた観測を置き、now の時点で見込みを出す
  function estimateAt(now: string, input: { cause?: IncidentCause; eventType?: string }) {
    const request = buildRequest({ now, cause: input.cause, statedResumeTime: stated });
    const entry = { ...buildEntryObservation(daytime, 0), statedResumeTime: stated };
    const observations: Observation[] = [
      input.eventType
        ? {
            ...entry,
            eventTypeCandidates: [{ eventType: input.eventType, confidence: "high" as const }],
          }
        : entry,
    ];
    const ctx: ToolContext = {
      request: { ...request, observations },
      observations,
      content: deps.content,
      provider: deps.provider,
      scenario: null,
      fetchRain: deps.fetchRain,
    };
    return runEstimateRemaining(ctx, { eventType: input.eventType ?? null });
  }

  const before = addMinutesToIso(stated, -1);
  const after = addMinutesToIso(stated, 1);

  it("種類が分かる原因は、放送の時刻の前は放送、ちょうどと後は統計値で見積もり、放送の時刻を残す", () => {
    const input = { eventType: "person_collision" };
    expect(estimateAt(before, input).remainingBasis).toBe("stated");
    for (const now of [stated, after]) {
      const result = estimateAt(now, input);
      expect(result.remainingBasis).toBe("statistics");
      expect(result.statedResumeTime).toBe(stated);
      expect(result.estimate.source).toBe("rule");
    }
  });

  it("大分類の原因も同じ時点で切り替え、放送の時刻と出どころを保つ", () => {
    const input = { cause: signaling };
    const early = estimateAt(before, input);
    expect(early.remainingBasis).toBe("stated");
    expect(early.estimate.remaining?.p50).toBe(1 + sectionWait.p50);
    expect(early.statedResumeTime).toBe(stated);
    expect(early.estimate.source).toBe("statistics");
    for (const now of [stated, after]) {
      const result = estimateAt(now, input);
      expect(result.remainingBasis).toBe("statistics");
      expect(result.statedResumeTime).toBe(stated);
      expect(result.estimate.source).toBe("statistics");
      expect(result.estimate.remaining).toEqual(expectStatsBoardable(signaling, daytime, now));
      expect(result.remainingSamples?.length).toBeGreaterThan(0);
    }
  });

  it("原因が分からなければ、放送の時刻が過ぎると見込みを持たないが、放送の時刻は残す", () => {
    expect(estimateAt(before, {}).remainingBasis).toBe("stated");
    for (const now of [stated, after]) {
      const result = estimateAt(now, {});
      expect(result.remainingBasis).toBeNull();
      expect(result.estimate.remaining).toBeNull();
      expect(result.statedResumeTime).toBe(stated);
      expect(result.estimate.source).toBe("none");
    }
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

  // Claude が estimate_remaining に eventType を渡す台本で判断する
  async function judgeWithClaude(request: JudgeRequest, eventType: string | null) {
    const calls: MessageCreateParamsNonStreaming[] = [];
    const script = [
      replyWithTool("estimate_remaining", { eventType }),
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

  it("観測に無い種類を Claude が指定しても、コードが決めた原因で統計値の見込みを出す", async () => {
    const request = buildRequest({ cause: signaling });
    const { judgment: claude } = await judgeWithClaude(request, "person_collision");
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBeNull();
    expect(claude.estimate.source).toBe("statistics");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });

  it("観測で決まった種類を Claude が null にしても、その種類で見込みを出す", async () => {
    const request = buildRequest({
      eventType: "person_collision",
      cause: { group: "passenger", type: "person_collision" },
    });
    const { judgment: claude } = await judgeWithClaude(request, null);
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBe("person_collision");
    expect(claude.estimate.source).toBe("rule");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });

  it("観測と違う種類を Claude が指定しても、観測で決まった種類を使う", async () => {
    const request = buildRequest({ eventType: "person_collision" });
    const { judgment: claude } = await judgeWithClaude(request, "vehicle_failure");
    const deterministic = findJudgment(await postJudge(app, request));
    expect(claude.estimate.eventType).toBe("person_collision");
    expect(claude.estimate).toEqual(deterministic.estimate);
  });
});
