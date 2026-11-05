import { formatLineName } from "@repo/geo";
import { loadGeoIndex } from "@repo/geo/node";
import type { Judgment, JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { findLineNicknameEn } from "../src/alternatives/line-names-en.ts";
import { createTestApp, createTestDeps, replayScenario } from "./helpers.ts";

// 英語の利用者には、経路のラベル・区間・説明文の路線名と駅名を英語名で返す

const deps = createTestDeps();
const geo = loadGeoIndex();
const japanese = /[぀-ヿ一-鿿]/;

// 英語名のある路線の日本語の表示名
const japaneseLineNames = geo
  .listLines()
  .filter((l) => l.nameEn)
  .flatMap((l) => [formatLineName(l), ...l.aliases]);

function findJudgment(events: JudgmentEvent[]): Judgment | null {
  const ready = events.find((e) => e.type === "judgment_ready");
  return ready?.type === "judgment_ready" ? ready.judgment : null;
}

type EnglishResult = { judgment: Judgment; observedLine: string | null };

async function judgeInEnglish(scenarioId: string, observationId: string): Promise<EnglishResult> {
  const scenario = deps.content.scenarios.get(scenarioId);
  if (!scenario) throw new Error(`${scenarioId} がありません`);
  const end = scenario.timeline.findIndex((e) => e.id === observationId);
  const english = {
    ...scenario,
    user: { ...scenario.user, language: "en" as const },
    timeline: scenario.timeline.slice(0, end + 1),
  };
  const steps = await replayScenario(createTestApp(deps), english);
  const judgment = findJudgment(steps.at(-1)?.events ?? []);
  if (!judgment) throw new Error("judgment_ready が届きません");
  // 観測のうち最後に路線名を持つもの。待つ選択肢の路線名はこれに揃う
  const observedLine =
    steps
      .flatMap((s) => s.events)
      .flatMap((e) =>
        e.type === "observation_parsed" && e.observation.line ? [e.observation.line] : [],
      )
      .at(-1) ?? null;
  return { judgment, observedLine };
}

describe("英語の判断: person_accident_last_train の obs_4", () => {
  const resultPromise = judgeInEnglish("person_accident_last_train", "obs_4");
  const judgmentPromise = resultPromise.then((r) => r.judgment);

  it("振替へ切り替える判断になる", async () => {
    const judgment = await judgmentPromise;
    expect(judgment.action).toBe("switch");
    expect(judgment.breakEven).not.toBeNull();
  });

  it("ラベルと説明文に日本語の路線名が残らない", async () => {
    const judgment = await judgmentPromise;
    const texts = [
      judgment.headline,
      judgment.reason ?? "",
      judgment.breakEven?.explanation ?? "",
      ...judgment.options.map((o) => o.label),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(japanese);
      for (const name of japaneseLineNames) expect(text).not.toContain(name);
    }
  });

  it("区間の路線名は英語名、駅名は英語名があれば英語名", async () => {
    const { judgment, observedLine } = await resultPromise;
    const legs = judgment.options.flatMap((o) => o.legs);
    expect(legs.length).toBeGreaterThan(0);
    // 止まっている路線は、観測の呼び方の英語名で返す
    const waitLegs = judgment.options.find((o) => o.kind === "wait")?.legs ?? [];
    const blockedLineId = waitLegs.find((l) => l.mode === "wait")?.lineId;
    const observedEn = observedLine ? findLineNicknameEn(observedLine) : null;
    for (const leg of legs) {
      const line = leg.lineId ? geo.getLine(leg.lineId) : undefined;
      const expected =
        observedEn && waitLegs.includes(leg) && leg.lineId === blockedLineId
          ? observedEn
          : line?.nameEn;
      if (expected) expect(leg.line).toBe(expected);
      const from = leg.fromStationId ? geo.getStation(leg.fromStationId) : undefined;
      const to = leg.toStationId ? geo.getStation(leg.toStationId) : undefined;
      if (from) expect(leg.from).toBe(from.nameEn ?? from.name);
      if (to) expect(leg.to).toBe(to.nameEn ?? to.name);
    }
    expect(legs.some((l) => l.from === "Osaka")).toBe(true);
  });

  it("待つ選択肢のラベルは、観測の路線名の英語名を使う", async () => {
    const { judgment, observedLine } = await resultPromise;
    const wait = judgment.options.find((o) => o.kind === "wait");
    const observedEn = observedLine ? findLineNicknameEn(observedLine) : null;
    expect(wait?.label).toMatch(/^Wait for .+ to resume$/);
    if (observedEn) expect(wait?.label).toBe(`Wait for ${observedEn} to resume`);
  });

  it("兆候の根拠は、知見の日本語の説明ではなく英語の説明になる", async () => {
    const judgment = await judgmentPromise;
    const signals = judgment.evidence.filter((e) => e.kind === "signal");
    expect(signals.length).toBeGreaterThan(0);
    for (const e of signals) {
      expect(e.description).toMatch(new RegExp(`^Signal "${e.id}"`));
      const known = [...deps.content.knowledge.values()]
        .flatMap((k) => k.phases.flatMap((p) => p.signals))
        .find((s) => s.id === e.id);
      if (known) expect(e.description).not.toContain(known.description);
    }
  });

  it("推奨する経路のラベルは英語の書き方", async () => {
    const judgment = await judgmentPromise;
    const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
    expect(recommended?.label).toMatch(/^(Transfer service via|Via) /);
  });
});
