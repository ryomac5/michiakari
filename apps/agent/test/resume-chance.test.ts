import { addMinutesToIso, diffMinutes } from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  ResumeChance,
  Scenario,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { assembleJudgment, extractTextNumbers } from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import {
  buildChanceSentence,
  buildDecisionText,
  formatChance,
  formatClock,
} from "../src/judge/templates.ts";
import {
  buildScenarioRequest,
  createTestApp,
  createTestDeps,
  postJudge,
  replayScenario,
} from "./helpers.ts";

// 時刻ごとの再開の見込みと、待ったほうが早く着く確率。決定論モードとダミーの内容で確かめる

const deps = createTestDeps();
const app = createTestApp(deps);

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

function loadScenario(id: string): Scenario {
  const scenario = deps.content.scenarios.get(id);
  if (!scenario) throw new Error(`ダミーのシナリオがありません: ${id}`);
  return scenario;
}

function requireChance(judgment: Judgment): ResumeChance {
  const chance = judgment.breakEven?.resumeChance;
  if (!chance) throw new Error("resumeChance がありません");
  return chance;
}

// 入口の路線の観測と同じ形。事象の候補も兆候も持たず、発表の時刻だけを載せる
function buildEntryObservation(now: string, statedResumeTime: string | null): Observation {
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

function buildEntryRequest(now: string, statedResumeTime: string | null): JudgeRequest {
  return {
    observations: [buildEntryObservation(now, statedResumeTime)],
    newInput: null,
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
  };
}

describe("人身事故のリプレイの再開の見込み", () => {
  const scenario = loadScenario("person_accident_last_train");
  const stepsPromise = replayScenario(createTestApp(deps), scenario);

  it("最初の判断では、発生から下限までの目盛りが 1 割未満で、待ったほうが早く着く見込みも 1 割未満", async () => {
    const steps = await stepsPromise;
    const judgment = findJudgment(steps[0]?.events ?? []);
    const chance = requireChance(judgment);
    expect(chance.onsetTime).toBe(scenario.start_time);
    const before = chance.ticks.filter((t) => (t.sinceOnsetMinutes ?? 0) < 60);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((t) => t.tenths === 0)).toBe(true);
    expect(chance.ticks.at(-1)?.tenths).toBeGreaterThanOrEqual(9);
    expect(chance.waitFaster).toBe(0);
    // 期限 00:25 があるので、待って間に合う確率と、そのための再開の時刻が付く
    expect(chance.waitOnTime).not.toBeNull();
    expect(chance.resumeByForDeadline).not.toBeNull();
    expect(judgment.action).toBe("switch");
    expect(judgment.reason).toMatch(/分岐点の\d{1,2}時\d{2}分までに再開する見込みは1割未満です。$/);
  });

  it("発表が届くたびに確率が変わり、理由の最後に確率の 1 文が付く", async () => {
    const steps = await stepsPromise;
    const chances = steps.map((s) => requireChance(findJudgment(s.events)));
    const keys = new Set(chances.map((c) => JSON.stringify(c.ticks)));
    expect(keys.size).toBeGreaterThan(1);
    for (const step of steps) {
      const judgment = findJudgment(step.events);
      // 期限が理由でタクシーを勧める観測は、タクシーより早いかを比べず、待って期限に間に合う見込みを言う
      const byDeadline = requireChance(judgment).waitFaster === null;
      expect(judgment.reason, step.entry.id).toMatch(
        byDeadline
          ? /待って期限に間に合うために必要な\d{1,2}時\d{2}分までの再開の見込みは(\d割|1割未満|9割以上)です。$/
          : /分岐点の\d{1,2}時\d{2}分までに再開する見込みは(\d割|1割未満|9割以上)です。$/,
      );
    }
  });

  it("期限が理由でタクシーを勧める観測では、分岐点と同じ時刻の確率だけを出す", async () => {
    // obs_5: 振替では期限 00:25 に間に合わず、タクシーなら間に合う
    const steps = await stepsPromise;
    const judgment = findJudgment(steps.find((s) => s.entry.id === "obs_5")?.events ?? []);
    const chance = requireChance(judgment);
    const taxi = judgment.options.find((o) => o.kind === "taxi");
    expect(judgment.action).toBe("switch");
    expect(judgment.recommendedOptionId).toBe(taxi?.id);
    // 待ったほうが早く着く確率は、タクシーの到着と比べるものなので出さない
    expect(chance.waitFaster).toBeNull();
    expect(chance.waitOnTime).not.toBeNull();
    // 分岐点は、待っても期限に間に合う最後の再開の時刻。期限に間に合う確率の「動いていなければならない時刻」と同じ
    expect(chance.resumeByForDeadline).toBe(judgment.breakEven?.time);
    expect(judgment.breakEven?.explanation).toMatch(
      /までに再開すれば.+着のタクシーに切り替えず期限に間に合います。$/,
    );
    // 期限が理由でないほかの観測は、これまでどおり待ったほうが早く着く確率を出す
    const others = steps.filter((s) => s.entry.id !== "obs_5");
    for (const step of others) {
      expect(requireChance(findJudgment(step.events)).waitFaster, step.entry.id).not.toBeNull();
    }
  });

  it("確率の目盛りは切りのよい時刻で 4〜6 個、時刻とともに減らない", async () => {
    const steps = await stepsPromise;
    for (const step of steps) {
      const chance = requireChance(findJudgment(step.events));
      expect(chance.ticks.length).toBeGreaterThanOrEqual(4);
      expect(chance.ticks.length).toBeLessThanOrEqual(6);
      for (const [i, tick] of chance.ticks.entries()) {
        const minute = Number(formatClock(tick.time, "en").slice(3));
        expect(minute % chance.stepMinutes, step.entry.id).toBe(0);
        if (i > 0) expect(tick.tenths).toBeGreaterThanOrEqual(chance.ticks[i - 1]?.tenths ?? 0);
      }
    }
  });
});

describe("車内対応のリプレイの再開の見込み", () => {
  it("発生から 10 分ほどの目盛りが高い確率になり、待つ判断と向きがそろう", async () => {
    const scenario = loadScenario("in_car_response_loop");
    const steps = await replayScenario(createTestApp(deps), scenario);
    const judgment = findJudgment(steps[0]?.events ?? []);
    const chance = requireChance(judgment);
    const tenMinutes = chance.ticks.find((t) => t.sinceOnsetMinutes === 10);
    expect(tenMinutes?.tenths).toBeGreaterThanOrEqual(7);
    expect(chance.waitFaster).toBeGreaterThanOrEqual(9);
    expect(judgment.action).toBe("wait");
    expect(judgment.reason).toMatch(/^車内対応は5〜10分ほどで終わることが多いです。/);
    expect(judgment.reason).toMatch(
      /分岐点の\d{1,2}時\d{2}分までに再開する見込みは(9割|9割以上)です。$/,
    );
  });
});

describe("原因が分からないときの再開の見込み", () => {
  const now = "2026-11-05T22:00:00+09:00";

  it("発表の時刻も無ければ確率を出さず、理由にも確率の 1 文を入れない", async () => {
    const judgment = findJudgment(await postJudge(app, buildEntryRequest(now, null)));
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.breakEven).not.toBeNull();
    expect(judgment.breakEven?.resumeChance).toBeUndefined();
    expect(judgment.reason).not.toContain("見込みは");
  });

  it("発表の時刻だけがあれば、その時刻でおよそ 5 割になる確率を出す", async () => {
    const stated = addMinutesToIso(now, 30);
    const judgment = findJudgment(await postJudge(app, buildEntryRequest(now, stated)));
    const chance = requireChance(judgment);
    const atStated = chance.ticks.find((t) => t.time === stated);
    expect(atStated?.tenths).toBe(5);
    expect(chance.waitFaster).not.toBeNull();
    expect(judgment.reason).toMatch(
      /分岐点の\d{1,2}時\d{2}分までに再開する見込みは(\d割|1割未満|9割以上)です。$/,
    );
  });
});

describe("英語の判断", () => {
  it("確率の 1 文を英語で添え、数値の検査を通る", async () => {
    const scenario = loadScenario("in_car_response_loop");
    const english = {
      ...scenario,
      user: { ...scenario.user, language: "en" as const },
      timeline: scenario.timeline.slice(0, 1),
    };
    const steps = await replayScenario(createTestApp(deps), english);
    const judgment = findJudgment(steps[0]?.events ?? []);
    expect(judgment.reason).toMatch(
      /The chance of resuming by \d{2}:\d{2} is (\d0%|under 10%|over 90%)\.$/,
    );
  });
});

describe("formatChance と buildChanceSentence", () => {
  it("1 割未満と 9 割以上はその言い方にし、0 割と 10 割は書かない", () => {
    expect(formatChance(0, "ja")).toBe("1割未満");
    expect(formatChance(3, "ja")).toBe("3割");
    expect(formatChance(10, "ja")).toBe("9割以上");
    expect(formatChance(0, "en")).toBe("under 10%");
    expect(formatChance(3, "en")).toBe("30%");
    expect(formatChance(10, "en")).toBe("over 90%");
  });

  it("待ったほうが早く着く確率を優先し、無ければ期限、目盛りの順に使う", () => {
    const tick = { time: "2026-11-05T23:30:00+09:00", tenths: 5 };
    expect(buildChanceSentence({ waitFaster: 3, waitOnTime: 6, keyTick: tick }, "ja")).toBe(
      "待ったほうが早く着く見込みは3割です。",
    );
    expect(buildChanceSentence({ waitFaster: null, waitOnTime: 6, keyTick: tick }, "ja")).toBe(
      "待って期限に間に合う見込みは6割です。",
    );
    expect(buildChanceSentence({ waitFaster: null, waitOnTime: null, keyTick: tick }, "ja")).toBe(
      "23時30分には5割の見込みで動いています。",
    );
    expect(buildChanceSentence({ waitFaster: null, waitOnTime: null, keyTick: null }, "ja")).toBe(
      null,
    );
  });

  it("理由の最後に確率の 1 文を添え、上限を超えるなら流れの一文を先に外す", () => {
    const base = {
      language: "ja" as const,
      breakEvenMinutesFromNow: 3,
      breakEvenTime: "2026-11-05T23:23:00+09:00",
      resumeP50: "2026-11-05T23:40:00+09:00",
      resumeP80: "2026-11-05T23:55:00+09:00",
      marginP50Minutes: -17,
      deadline: null,
      bestOption: { kind: "transfer" as const, label: "振替", isTransferService: true },
      chance: { waitFaster: 2, waitOnTime: null, keyTick: null },
    };
    const short = buildDecisionText({ ...base, reason: "resume_after_break_even" });
    expect(short.reason).toMatch(/待ったほうが早く着く見込みは2割です。$/);
    const longFlow = {
      outlook: "long" as const,
      sentence: "人身事故は、再開まで1時間ほどかかるのがふつうです。",
      inReason: true,
    };
    const withFlow = buildDecisionText({
      ...base,
      reason: "resume_after_break_even",
      flow: longFlow,
    });
    expect(withFlow.reason).toMatch(/^人身事故は、再開まで1時間ほどかかるのがふつうです。/);
    expect(withFlow.reason).toMatch(/待ったほうが早く着く見込みは2割です。$/);
    // 長い理由では、流れの一文を外して確率の一文を残す
    const crowded = buildDecisionText({
      ...base,
      reason: "resume_mostly_after_break_even",
      flow: longFlow,
    });
    expect(crowded.reason).not.toMatch(/^人身事故は/);
    expect(crowded.reason).toMatch(/待ったほうが早く着く見込みは2割です。$/);
  });
});

describe("確率の捏造の検査", () => {
  async function prepareSession(scenarioId: string) {
    const scenario = loadScenario(scenarioId);
    const entry = scenario.timeline[0];
    if (!entry) throw new Error("シナリオがありません");
    const request = buildScenarioRequest(scenario, entry, []);
    const knowledge = deps.content.knowledge.get(scenario.event_type);
    const signal = knowledge?.phases[0]?.signals[0];
    if (!knowledge || !signal) throw new Error("知見がありません");
    const observation: Observation = {
      id: entry.id,
      observedAt: request.now,
      source: "scenario",
      rawText: entry.text.ja,
      eventTypeCandidates: [{ eventType: knowledge.id, confidence: "high" }],
      operator: null,
      line: null,
      section: null,
      statedResumeTime: null,
      transferServiceActive: null,
      detectedSignals: [{ eventType: knowledge.id, signalId: signal.id, quote: "引用" }],
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
    await session.executeTool("estimate_phase_and_remaining", { eventType: knowledge.id });
    await session.executeTool("find_alternatives", {});
    const outcome = await session.executeTool("compute_break_even", {});
    const { estimate, alternatives, breakEven } = session.state;
    if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
    return {
      session,
      results: { estimate, alternatives, breakEven },
      signalId: signal.id,
      outcome,
      request,
    };
  }

  it("ツールの結果の確率はそのまま通り、無い確率は指摘する", async () => {
    const { session, results, signalId } = await prepareSession("person_accident_last_train");
    const chance = results.breakEven.resumeChance;
    if (!chance || chance.waitFaster === null) throw new Error("確率がありません");
    const tick = chance.ticks.find((t) => t.tenths > 0 && t.tenths < 10);
    if (!tick) throw new Error("中間の確率の目盛りがありません");
    const minutesFromNow = Math.round(
      diffMinutes(results.estimate.phaseStartedAt ?? "", tick.time),
    );
    const decision = (reason: string) => ({
      action: "switch" as const,
      headline: "いま振替に切り替えてください",
      reason,
      breakEvenExplanation: "説明",
      recommendedOptionId:
        results.breakEven.result.kind === "future"
          ? results.breakEven.result.bestAlternativeId
          : null,
      evidence: [{ kind: "signal" as const, id: signalId, description: "根拠" }],
    });
    const fine = assembleJudgment(
      results,
      decision(
        `待ったほうが早く着く見込みは${formatChance(chance.waitFaster, "ja")}です。${minutesFromNow}分後の${formatClock(tick.time, "ja")}には${formatChance(tick.tenths, "ja")}の見込みで動いています。`,
      ),
      "ja",
    );
    expect(session.checkJudgment(fine, results).errors).toEqual([]);

    const fabricated = assembleJudgment(
      results,
      decision("待ったほうが早く着く見込みは4割です。"),
      "ja",
    );
    const { errors } = session.checkJudgment(fabricated, results);
    expect(errors.some((e) => e.includes("4割"))).toBe(true);
  });

  it("Claude へのツール結果に確率の表示が入り、標本は渡さない", async () => {
    const { outcome, results } = await prepareSession("person_accident_last_train");
    const content = outcome.content as {
      labels?: { resumeChance?: { waitFaster: string | null; ticks: { chance: string }[] } };
    };
    expect(content.labels?.resumeChance?.waitFaster).toBe("1割未満");
    expect(content.labels?.resumeChance?.ticks.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(outcome.content)).not.toContain("remainingSamples");
    expect(results.estimate.remainingSamples?.length).toBeGreaterThan(0);
  });
});

describe("extractTextNumbers の割合", () => {
  it("「3割」「30%」「under 10%」を 1 割単位で拾う", () => {
    const n = extractTextNumbers(
      "見込みは3割です。The chance is 30%, or under 10%, or 25 percent.",
    );
    expect(n.shares.map((s) => s.tenths)).toEqual([3, 3, 1, 2.5]);
    expect(n.minutes).toEqual([]);
  });
});
