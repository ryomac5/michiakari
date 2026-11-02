import { checkJudgmentRefs, type JudgmentEvent, JudgmentEventSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildPersonAccidentEvents, personAccidentCatalog } from "./fixtures/person-accident";
import { streamMockJudgment } from "./mock";
import { buildTestRequest } from "./test-helpers";

function findJudgment(events: JudgmentEvent[]) {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready がありません");
  return ready.judgment;
}

function findFirstObservation() {
  const parsed = buildPersonAccidentEvents(buildTestRequest()).find(
    (e) => e.type === "observation_parsed",
  );
  if (parsed?.type !== "observation_parsed") throw new Error("observation_parsed がありません");
  return parsed.observation;
}

describe("人身事故のモック", () => {
  it.each([
    ["初回", buildTestRequest()],
    ["情報の追加", buildTestRequest({ observations: [findFirstObservation()] })],
    ["英語", buildTestRequest({ language: "en" })],
  ])("%s のイベントはすべてスキーマに合い、seq は連番になる", (_label, request) => {
    const events = buildPersonAccidentEvents(request);
    for (const event of events) expect(JudgmentEventSchema.safeParse(event).success).toBe(true);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(checkJudgmentRefs(findJudgment(events))).toEqual([]);
  });

  it("初回は待つ、観測を返送した 2 回目は切り替えるを返す", () => {
    const first = buildPersonAccidentEvents(buildTestRequest());
    const second = buildPersonAccidentEvents(
      buildTestRequest({ observations: [findFirstObservation()] }),
    );
    expect(findJudgment(first).action).toBe("wait");
    expect(findJudgment(second).action).toBe("switch");
  });

  it("貼り付けた文章を観測の原文に入れる", () => {
    const events = buildPersonAccidentEvents(
      buildTestRequest({ newInput: { type: "text", text: "架空の掲示" } }),
    );
    expect(events[0]).toMatchObject({
      type: "observation_parsed",
      observation: { rawText: "架空の掲示" },
    });
  });

  it("新しい入力が無ければ observation_parsed を出さない", () => {
    const events = buildPersonAccidentEvents(buildTestRequest({ newInput: null }));
    expect(events.some((e) => e.type === "observation_parsed")).toBe(false);
  });

  it("兆候と段階は知見の抜粋にある id を指す", () => {
    const events = buildPersonAccidentEvents(buildTestRequest());
    const phases = personAccidentCatalog[0]?.phases ?? [];
    const signalIds = phases.flatMap((p) => p.signals.map((s) => s.id));
    const judgment = findJudgment(events);
    expect(phases.map((p) => p.id)).toContain(judgment.estimate.phaseId);
    for (const e of events) {
      if (e.type === "signal_detected") expect(signalIds).toContain(e.signal.signalId);
    }
  });

  it("一定間隔で全イベントを流し、中断すると止まる", async () => {
    const request = buildTestRequest();
    const all: JudgmentEvent[] = [];
    for await (const e of streamMockJudgment(request, { intervalMs: 1 })) all.push(e);
    expect(all).toHaveLength(buildPersonAccidentEvents(request).length);

    const controller = new AbortController();
    const some: JudgmentEvent[] = [];
    for await (const e of streamMockJudgment(request, {
      intervalMs: 1,
      signal: controller.signal,
    })) {
      some.push(e);
      controller.abort();
    }
    expect(some).toHaveLength(1);
  });
});
