import { parseIsoToMs } from "@repo/core";
import type { JudgmentEvent, JudgmentEventOf } from "@repo/schema";
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
  "weather_checked",
  "phase_estimated",
  "alternatives_computed",
  "break_even_computed",
  "judgment_ready",
];

// 観測によって流れないことがある種類
const OPTIONAL_TYPES: JudgmentEvent["type"][] = ["signal_detected", "weather_checked"];

// 同じ種類の連続をまとめた並び。途中経過の progress は除く
function collapseTypes(events: JudgmentEvent[]): string[] {
  return events
    .map((e) => e.type)
    .filter((t) => t !== "progress")
    .filter((t, i, all) => t !== all[i - 1]);
}

describe("判断イベントの列", () => {
  for (const scenario of scenarios) {
    it(`${scenario.id}: 各観測で決まった順に流れ、seq が 0 からの連番になる`, async () => {
      const steps = await replayScenario(createTestApp(deps), scenario);
      for (const { entry, events } of steps) {
        const types = collapseTypes(events);
        const expected = ORDER.filter((t) => !OPTIONAL_TYPES.includes(t) || types.includes(t));
        expect(types, entry.id).toEqual(expected);
        expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
        const now = buildScenarioRequest(scenario, entry, []).now;
        expect(events.every((e) => e.at === now)).toBe(true);
      }
    });
  }

  it("決定論モードでは、バス停の確認候補を判断の後に付け、見出し・理由・推奨には入れない", async () => {
    let seen = 0;
    for (const scenario of scenarios) {
      const steps = await replayScenario(createTestApp(deps), scenario);
      for (const { entry, events } of steps) {
        const computed = events.find((e) => e.type === "alternatives_computed");
        expect(computed && "busChecks" in computed, entry.id).toBe(false);
        const ready = events.find((e) => e.type === "judgment_ready");
        if (ready?.type !== "judgment_ready") continue;
        const { judgment } = ready;
        for (const check of judgment.busChecks ?? []) {
          seen += 1;
          expect(judgment.headline, entry.id).not.toContain(check.stopName);
          expect(judgment.reason ?? "", entry.id).not.toContain(check.stopName);
          expect(judgment.recommendedOptionId, entry.id).not.toBe(check.id);
          expect(judgment.options.some((o) => o.id === check.id)).toBe(false);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("決定論モードでも各段階の開始を利用者の言語で流す", async () => {
    const scenario = scenarios[0];
    const entry = scenario?.timeline[0];
    if (!scenario || !entry) throw new Error("シナリオがありません");
    for (const language of ["ja", "en"] as const) {
      const request = { ...buildScenarioRequest(scenario, entry, []), language };
      const events = await postJudge(createTestApp(deps), request);
      const progress = events.flatMap((e) => (e.type === "progress" ? [e] : []));
      const stages = progress.map((e) => e.stage);
      expect(stages).toEqual(
        expect.arrayContaining(["interpret", "phase", "alternatives", "break_even", "judgment"]),
      );
      const japanese = /[ぁ-んァ-ヶ一-龥]/;
      expect(progress.every((e) => japanese.test(e.message) === (language === "ja"))).toBe(true);
      // 段階の開始は、その段階の結果より前に届く
      const indexOf = (pred: (e: (typeof events)[number]) => boolean) => events.findIndex(pred);
      expect(indexOf((e) => e.type === "progress" && e.stage === "phase")).toBeLessThan(
        indexOf((e) => e.type === "phase_estimated"),
      );
    }
  });

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
    const types = collapseTypes(events);
    expect(types).toEqual(
      ORDER.slice(1).filter((t) => !OPTIONAL_TYPES.includes(t) || types.includes(t)),
    );
  });
});

function pickWeatherChecked(events: JudgmentEvent[]): JudgmentEventOf<"weather_checked">[] {
  return events.flatMap((e) => (e.type === "weather_checked" ? [e] : []));
}

// 知見が気象を使う事象かどうか。シナリオ ID は埋め込まず、知見の external_factors で分ける
function usesWeather(scenario: (typeof scenarios)[number]): boolean {
  return deps.content.knowledge.get(scenario.event_type)?.external_factors.weather === true;
}

describe("weather_checked", () => {
  const weatherScenarios = scenarios.filter((s) => usesWeather(s) && s.weather);
  const otherScenarios = scenarios.filter((s) => !usesWeather(s));

  it("気象を使う事象と使わない事象のダミーがそろっている", () => {
    expect(weatherScenarios.length).toBeGreaterThan(0);
    expect(otherScenarios.length).toBeGreaterThan(0);
  });

  for (const scenario of weatherScenarios) {
    it(`${scenario.id}: 各観測で 1 回だけ流れ、現在時刻より先の雨量を含まない`, async () => {
      const steps = await replayScenario(createTestApp(deps), scenario);
      for (const { entry, events } of steps) {
        const checked = pickWeatherChecked(events);
        expect(checked, entry.id).toHaveLength(1);
        const event = checked[0];
        if (!event) throw new Error("weather_checked がありません");
        const now = buildScenarioRequest(scenario, entry, []).now;
        const last = event.readings.at(-1);
        expect(last, entry.id).toBeDefined();
        expect(parseIsoToMs(last?.time ?? now), entry.id).toBeLessThanOrEqual(parseIsoToMs(now));
        expect(event.source).toBe("scenario");
        expect(event.summary.length).toBeGreaterThan(0);
        // 段階の推定より前に届く
        const indexOf = (type: JudgmentEvent["type"]) => events.findIndex((e) => e.type === type);
        expect(indexOf("weather_checked")).toBeLessThan(indexOf("phase_estimated"));
      }
    });
  }

  for (const scenario of otherScenarios) {
    it(`${scenario.id}: 気象を使わない事象では流れない`, async () => {
      const steps = await replayScenario(createTestApp(deps), scenario);
      for (const { entry, events } of steps) {
        expect(pickWeatherChecked(events), entry.id).toHaveLength(0);
      }
    });
  }

  // シナリオを使わず文章で入れると、気象庁の取得に進む
  function buildTextRequest() {
    const scenario = weatherScenarios[0];
    const entry = scenario?.timeline[0];
    if (!scenario || !entry) throw new Error("気象を使うシナリオがありません");
    const request = buildScenarioRequest(scenario, entry, []);
    return { ...request, newInput: { type: "text" as const, text: entry.text.ja } };
  }

  it("気象庁の取得に失敗したら流さない", async () => {
    const events = await postJudge(createTestApp(deps), buildTextRequest());
    expect(events.some((e) => e.type === "judgment_ready")).toBe(true);
    expect(pickWeatherChecked(events)).toHaveLength(0);
  });

  it("気象庁から取れたら出典を jma として流す", async () => {
    const request = buildTextRequest();
    const readings = [-20, -10, 0].map((offset, i) => ({
      time: new Date(parseIsoToMs(request.now) + offset * 60_000).toISOString(),
      rainfall10minMm: [4, 2, 1][i] ?? null,
      warnings: [],
    }));
    const jmaDeps = createTestDeps({
      fetchRain: async () => ({ stationName: "テスト観測所", readings }),
    });
    const events = await postJudge(createTestApp(jmaDeps), request);
    const checked = pickWeatherChecked(events);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toMatchObject({ source: "jma", trend: "falling", warnings: [] });
    expect(checked[0]?.readings.map((r) => r.rainfall10minMm)).toEqual([4, 2, 1]);
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
    expect(collapseTypes(events)).toEqual(["error"]);
    expect(events.find((e) => e.type === "error")).toMatchObject({ retryable: false });
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

  it("X-Forwarded-For は trustProxy のときだけ頻度制限の単位に使う", async () => {
    const send = (app: ReturnType<typeof createApp>, ip: string) =>
      app.request("/judge", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(valid),
      });
    const options = { judge: deps, corsOrigins: ["http://localhost:3000"], rateLimitPerWindow: 1 };
    const trusted = createApp({ ...options, trustProxy: true });
    expect((await send(trusted, "203.0.113.1")).status).toBe(200);
    expect((await send(trusted, "203.0.113.2")).status).toBe(200);
    const untrusted = createApp(options);
    expect((await send(untrusted, "203.0.113.1")).status).toBe(200);
    expect((await send(untrusted, "203.0.113.2")).status).toBe(429);
  });

  it("CORS は許可したオリジンにだけ応える", async () => {
    const app = createTestApp(deps);
    const allowed = await app.request("/health", { headers: { origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const denied = await app.request("/health", { headers: { origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
