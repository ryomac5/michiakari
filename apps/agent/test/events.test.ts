import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import {
  buildScenarioRequest,
  createTestApp,
  createTestDeps,
  parseSseEvents,
  postJudge,
  replayScenario,
} from "./helpers.ts";

// 判断イベントの順序・連番・スキーマ準拠と、入口の上限を確かめる

const deps = createTestDeps();
const scenarios = [...deps.content.scenarios.values()];

const ORDER: JudgmentEvent["type"][] = [
  "observation_parsed",
  "signal_detected",
  "phase_estimated",
  "alternatives_computed",
  "break_even_computed",
  "judgment_ready",
];

// 同じ種類の連続をまとめた並び
function collapseTypes(events: JudgmentEvent[]): string[] {
  return events.map((e) => e.type).filter((t, i, all) => t !== all[i - 1]);
}

describe("判断イベントの列", () => {
  for (const scenario of scenarios) {
    it(`${scenario.id}: 各観測で決まった順に流れ、seq が 0 からの連番になる`, async () => {
      const steps = await replayScenario(createTestApp(deps), scenario);
      for (const { entry, events } of steps) {
        const types = collapseTypes(events);
        const expected = ORDER.filter((t) => t !== "signal_detected" || types.includes(t));
        expect(types, entry.id).toEqual(expected);
        expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
        const now = buildScenarioRequest(scenario, entry, []).now;
        expect(events.every((e) => e.at === now)).toBe(true);
      }
    });
  }

  it("兆候のイベントは観測をまたいで重複しない", async () => {
    const scenario = scenarios[0];
    if (!scenario) throw new Error("シナリオがありません");
    const steps = await replayScenario(createTestApp(deps), scenario);
    for (const { events } of steps) {
      const ids = events.flatMap((e) => (e.type === "signal_detected" ? [e.signal.signalId] : []));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("newInput が無ければ observation_parsed を送らずに判断する", async () => {
    const scenario = scenarios[0];
    const entry = scenario?.timeline[0];
    if (!scenario || !entry) throw new Error("シナリオがありません");
    const first = await postJudge(createTestApp(deps), buildScenarioRequest(scenario, entry, []));
    const parsed = first.find((e) => e.type === "observation_parsed");
    if (parsed?.type !== "observation_parsed") throw new Error("観測がありません");
    const request = {
      ...buildScenarioRequest(scenario, entry, [parsed.observation]),
      newInput: null,
    };
    const events = await postJudge(createTestApp(deps), request);
    expect(collapseTypes(events)).toEqual(ORDER.slice(1));
  });
});

describe("入口の検証と上限", () => {
  const scenario = scenarios[0];
  const entry = scenario?.timeline[0];
  if (!scenario || !entry) throw new Error("シナリオがありません");
  const valid = buildScenarioRequest(scenario, entry, []);

  it("不正なリクエストは 400 と error イベント", async () => {
    const res = await createTestApp(deps).request("/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, now: "not-a-date" }),
    });
    expect(res.status).toBe(400);
    const events = parseSseEvents(await res.text());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", seq: 0, retryable: false });
  });

  it("決定論モードの写真入力は再試行できない error イベント", async () => {
    const events = await postJudge(createTestApp(deps), {
      ...valid,
      newInput: { type: "photo", imageBase64: "aGVsbG8=", mediaType: "image/png" },
    });
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ retryable: false });
  });

  it("大きすぎる画像は 413", async () => {
    const res = await createTestApp(deps).request("/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...valid,
        newInput: {
          type: "photo",
          imageBase64: "A".repeat(7 * 1024 * 1024),
          mediaType: "image/png",
        },
      }),
    });
    expect(res.status).toBe(413);
  });

  it("頻度の上限を超えると 429 と再試行できる error イベント", async () => {
    const app = createApp({
      judge: deps,
      corsOrigins: ["http://localhost:3000"],
      rateLimitPerWindow: 1,
    });
    await postJudge(app, valid);
    const res = await app.request("/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    });
    expect(res.status).toBe(429);
    expect(parseSseEvents(await res.text())[0]).toMatchObject({ type: "error", retryable: true });
  });

  it("CORS は許可したオリジンにだけ応える", async () => {
    const app = createTestApp(deps);
    const allowed = await app.request("/health", { headers: { origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const denied = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
