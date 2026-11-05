import { join } from "node:path";
import { addMinutesToIso } from "@repo/core";
import {
  type JudgeRequest,
  type JudgmentEvent,
  JudgmentEventSchema,
  type Observation,
  resolveDeadline,
  type Scenario,
  type TimelineEntry,
} from "@repo/schema";
import { findRepoRoot } from "@repo/schema/loaders";
import { createGeoProvider } from "../src/alternatives/geo-provider.ts";
import { createApp } from "../src/app.ts";
import { loadContentStore } from "../src/content.ts";
import type { JudgeDeps } from "../src/judge/run-judge.ts";
import { loadPrompts } from "../src/prompts/load-prompts.ts";

// テスト用の共通部品。開発用のダミー知見とシナリオを読む（読むだけで変更しない）

export const DEV_CONTENT_DIR = join(findRepoRoot(), "packages/schema/test/fixtures/dev-content");

export function createTestDeps(overrides: Partial<JudgeDeps> = {}): JudgeDeps {
  return {
    mode: "deterministic",
    content: loadContentStore(DEV_CONTENT_DIR),
    provider: createGeoProvider(),
    fetchRain: async () => null,
    llm: null,
    prompts: loadPrompts(),
    logWarning: () => {},
    ...overrides,
  };
}

export function createTestApp(deps: JudgeDeps = createTestDeps()) {
  return createApp({
    judge: deps,
    corsOrigins: ["http://localhost:3000"],
    rateLimitPerWindow: 1000,
  });
}

// SSE の本文を判断イベントの列に直す。各イベントはスキーマで検証する
export function parseSseEvents(body: string): JudgmentEvent[] {
  return body
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data.length > 0)
    .map((data) => JudgmentEventSchema.parse(JSON.parse(data)));
}

export function buildScenarioRequest(
  scenario: Scenario,
  entry: TimelineEntry,
  observations: Observation[],
): JudgeRequest {
  const { user } = scenario;
  return {
    observations,
    newInput: {
      type: "scenario",
      scenarioId: scenario.id,
      observationId: entry.id,
      kind: entry.kind,
      text: entry.text,
    },
    origin: { kind: "station", name: user.current_station },
    destination: { kind: "station", name: user.destination },
    constraints: {
      deadline: user.constraints.deadline
        ? resolveDeadline(scenario.start_time, user.constraints.deadline)
        : null,
      knowsAlternatives: user.constraints.knows_alternatives,
      mobilityNotes: user.constraints.mobility_notes,
    },
    language: user.language,
    now: addMinutesToIso(scenario.start_time, entry.offset_minutes),
  };
}

export async function postJudge(
  app: ReturnType<typeof createApp>,
  request: unknown,
): Promise<JudgmentEvent[]> {
  const res = await app.request("/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseSseEvents(await res.text());
}

export type ReplayStep = {
  entry: TimelineEntry;
  events: JudgmentEvent[];
};

// シナリオの timeline を順に入れて、各観測の後のイベント列を返す
export async function replayScenario(
  app: ReturnType<typeof createApp>,
  scenario: Scenario,
): Promise<ReplayStep[]> {
  const observations: Observation[] = [];
  const steps: ReplayStep[] = [];
  for (const entry of scenario.timeline) {
    const events = await postJudge(app, buildScenarioRequest(scenario, entry, [...observations]));
    const parsed = events.find((e) => e.type === "observation_parsed");
    if (parsed?.type === "observation_parsed") observations.push(parsed.observation);
    steps.push({ entry, events });
  }
  return steps;
}
