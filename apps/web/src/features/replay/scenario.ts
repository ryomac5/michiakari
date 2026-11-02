import {
  type JudgeRequest,
  JudgeRequestSchema,
  type Lang,
  type LocalizedText,
  type Observation,
  type Place,
  resolveDeadline,
  type Scenario,
  type TimelineEntry,
} from "@repo/schema";

// リプレイで画面に渡すシナリオの抜粋と、観測 1 件ぶんの POST /judge の要求

export type ReplayScenario = Pick<
  Scenario,
  "id" | "title" | "event_type" | "operator" | "line" | "blocked_section" | "start_time" | "user"
> & { timeline: TimelineEntry[] };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

// 期待値と正解はリプレイの表示に使わないので画面へ渡さない
export function buildReplayScenario(scenario: Scenario): ReplayScenario {
  const { id, title, event_type, operator, line, blocked_section, start_time, user, timeline } =
    scenario;
  return { id, title, event_type, operator, line, blocked_section, start_time, user, timeline };
}

// start_time から offsetMinutes 後の時刻を日本時間の ISO 8601（秒まで）で返す
export function resolveScenarioTime(startTime: string, offsetMinutes: number): string {
  const ms = Date.parse(startTime) + Math.round(offsetMinutes * 60) * 1000;
  const wall = new Date(ms + JST_OFFSET_MS);
  const day = `${wall.getUTCFullYear()}-${padTwo(wall.getUTCMonth() + 1)}-${padTwo(wall.getUTCDate())}`;
  const clock = `${padTwo(wall.getUTCHours())}:${padTwo(wall.getUTCMinutes())}:${padTwo(wall.getUTCSeconds())}`;
  return `${day}T${clock}+09:00`;
}

type StationPlace = Extract<Place, { kind: "station" }>;

export function buildScenarioPlaces(scenario: ReplayScenario): {
  origin: StationPlace;
  destination: StationPlace;
} {
  return {
    origin: { kind: "station", name: scenario.user.current_station },
    destination: { kind: "station", name: scenario.user.destination },
  };
}

export function pickScenarioText(text: LocalizedText, language: Lang): string {
  return language === "en" && text.en ? text.en : text.ja;
}

// 観測 1 件を入力する要求。observations はこれまでに解釈済みのもの
export function buildReplayRequest(
  scenario: ReplayScenario,
  entry: TimelineEntry,
  observations: Observation[],
  language: Lang,
): JudgeRequest {
  const { user } = scenario;
  const { origin, destination } = buildScenarioPlaces(scenario);
  return JudgeRequestSchema.parse({
    observations,
    newInput: {
      type: "scenario",
      scenarioId: scenario.id,
      observationId: entry.id,
      kind: entry.kind,
      text: entry.text,
    },
    origin,
    destination,
    constraints: {
      deadline: user.constraints.deadline
        ? resolveDeadline(scenario.start_time, user.constraints.deadline)
        : null,
      knowsAlternatives: user.constraints.knows_alternatives,
      mobilityNotes: user.constraints.mobility_notes,
    },
    language,
    now: resolveScenarioTime(scenario.start_time, entry.offset_minutes),
  });
}
