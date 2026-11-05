import { addMinutesToIso, STATED_RESUME_SLACK_MINUTES } from "@repo/core";
import type { JudgeRequest, Judgment, JudgmentEvent, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createTestApp, postJudge } from "./helpers.ts";

// 入口で原因に「聞き取れなかった」、再開見込みに放送の時刻を選んだときの判断
// 事象が無くても、発表の時刻を見込みとして分岐点と比べ、待つか切り替えるかを言い切る

const app = createTestApp();
const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

// 入口の路線の観測と同じ形。事象の候補も兆候も持たず、発表の時刻だけを載せる
function buildEntryObservation(statedResumeTime: string | null): Observation {
  return {
    id: "entry-line",
    observedAt: addMinutesToIso(now, -10),
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line: "JR神戸線",
    section: null,
    statedResumeTime,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildRequest(statedResumeTime: string | null): JudgeRequest {
  return {
    observations: [buildEntryObservation(statedResumeTime)],
    newInput: null,
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
  };
}

describe("原因が分からず、発表の再開見込みがある判断", () => {
  it("発表の時刻が分岐点より前なら待つ。見込みは時刻どおりを p50、延びる余地を p80 にする", async () => {
    const stated = addMinutesToIso(now, 10);
    const judgment = findJudgment(await postJudge(app, buildRequest(stated)));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.remaining).toEqual({ p50: 10, p80: 10 + STATED_RESUME_SLACK_MINUTES });
    expect(judgment.estimate.confidence).toBe("medium");
    expect(judgment.breakEven).not.toBeNull();
    expect(Date.parse(judgment.breakEven?.time ?? "")).toBeGreaterThan(Date.parse(stated));
    expect(judgment.action).toBe("wait");
    expect(judgment.headline).toMatch(/^あと\d+分は待つ$/);
    expect(judgment.reason).toContain("発表の再開見込み22時10分");
    expect(judgment.reason).toContain("見込みどおりなら");
  });

  it("発表の時刻が分岐点より十分に後なら切り替える", async () => {
    const stated = addMinutesToIso(now, 90);
    const judgment = findJudgment(await postJudge(app, buildRequest(stated)));
    expect(judgment.estimate.eventType).toBeNull();
    expect(Date.parse(judgment.breakEven?.time ?? "")).toBeLessThan(Date.parse(stated));
    expect(judgment.action).toBe("switch");
    expect(judgment.headline).toMatch(/に切り替える$/);
    expect(judgment.reason).toContain("発表の再開見込み23時30分");
    expect(judgment.reason).toContain("見込みどおりでも");
  });

  it("発表の時刻が無ければ、従来どおり分岐点まで待って切り替える形にする", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(null)));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.estimate.confidence).toBe("low");
    expect(judgment.action).toBe("hold");
    expect(judgment.headline).toMatch(/までに動かなければ切り替える$/);
  });
});
