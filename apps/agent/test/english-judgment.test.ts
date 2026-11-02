import { formatLineName } from "@repo/geo";
import { loadGeoIndex } from "@repo/geo/node";
import type { Judgment, JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
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

async function judgeInEnglish(scenarioId: string, observationId: string): Promise<Judgment> {
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
  return judgment;
}

describe("英語の判断: person_accident_last_train の obs_4", () => {
  const judgmentPromise = judgeInEnglish("person_accident_last_train", "obs_4");

  it("振替へ切り替える判断になる", async () => {
    const judgment = await judgmentPromise;
    expect(judgment.action).toBe("switch");
    expect(judgment.breakEven).not.toBeNull();
  });

  it("ラベルと説明文に日本語の路線名が残らない", async () => {
    const judgment = await judgmentPromise;
    const texts = [
      judgment.headline,
      judgment.breakEven?.explanation ?? "",
      ...judgment.options.map((o) => o.label),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(japanese);
      for (const name of japaneseLineNames) expect(text).not.toContain(name);
    }
  });

  it("区間の路線名は英語名、駅名は英語名があれば英語名", async () => {
    const judgment = await judgmentPromise;
    const legs = judgment.options.flatMap((o) => o.legs);
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) {
      const line = leg.lineId ? geo.getLine(leg.lineId) : undefined;
      if (line?.nameEn) expect(leg.line).toBe(line.nameEn);
      const from = leg.fromStationId ? geo.getStation(leg.fromStationId) : undefined;
      const to = leg.toStationId ? geo.getStation(leg.toStationId) : undefined;
      if (from) expect(leg.from).toBe(from.nameEn ?? from.name);
      if (to) expect(leg.to).toBe(to.nameEn ?? to.name);
    }
    expect(legs.some((l) => l.from === "Osaka")).toBe(true);
  });

  it("推奨する経路のラベルは英語の書き方", async () => {
    const judgment = await judgmentPromise;
    const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
    expect(recommended?.label).toMatch(/^(Transfer service via|Via) /);
  });
});
