import type { JudgeRequest, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import type { AlternativesProvider, AlternativesQuery } from "../src/alternatives/provider.ts";
import { runFindAlternatives } from "../src/tools/find-alternatives.ts";
import type { EstimateToolResult, ToolContext } from "../src/tools/types.ts";

// 止まっている区間は観測から取る。ツールの引数の区間は発表と照らし合わせ、合わなければ使わない

const now = "2026-11-05T22:00:00+09:00";

function buildObservation(section: Observation["section"]): Observation {
  return {
    id: "obs",
    observedAt: "2026-11-05T21:50:00+09:00",
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line: "JR神戸線",
    section,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildContext(observations: Observation[], queries: AlternativesQuery[]): ToolContext {
  const provider = {
    findAlternatives: async (query: AlternativesQuery) => {
      queries.push(query);
      return { options: [], waitOptionId: "wait", waitRouteMinutesAfterResume: null, notes: [] };
    },
  } as unknown as AlternativesProvider;
  const request = {
    observations,
    newInput: null,
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    trainPosition: {
      kind: "between_stations",
      nextStation: "塚本",
      previousStation: "大阪",
      trainsAhead: null,
      trainsAheadCount: null,
      ownTrainType: null,
    },
  } as unknown as JudgeRequest;
  return { request, observations, provider } as unknown as ToolContext;
}

const estimate = {
  estimate: { remaining: { p50: 30, p80: 60 } },
  trainQueue: null,
  firstTrainWait: null,
} as unknown as EstimateToolResult;

describe("runFindAlternatives", () => {
  it("発表に無い区間を引数で渡されても使わず、駅の間の仮定で探す", async () => {
    const queries: AlternativesQuery[] = [];
    await runFindAlternatives(buildContext([buildObservation(null)], queries), estimate, {
      blockedSection: { fromStation: "大阪", toStation: "京都" },
    });
    expect(queries[0]?.blockedSection).toEqual({ fromStation: "大阪", toStation: "三ノ宮" });
    expect(queries[0]?.blockedSectionFromTrain).toBe(true);
  });

  it("引数の区間が発表と違えば、発表の区間を使う", async () => {
    const queries: AlternativesQuery[] = [];
    const announced = { fromStation: "大阪", toStation: "西明石" };
    await runFindAlternatives(buildContext([buildObservation(announced)], queries), estimate, {
      blockedSection: { fromStation: "大阪", toStation: "京都" },
    });
    expect(queries[0]?.blockedSection).toEqual(announced);
    expect(queries[0]?.blockedSectionFromTrain).toBe(false);
  });

  it("引数の区間が発表と同じなら、向きが逆でもそのまま使う", async () => {
    const queries: AlternativesQuery[] = [];
    const announced = { fromStation: "大阪", toStation: "西明石" };
    await runFindAlternatives(buildContext([buildObservation(announced)], queries), estimate, {
      blockedSection: { fromStation: "西明石", toStation: "大阪" },
    });
    expect(queries[0]?.blockedSection).toEqual({ fromStation: "西明石", toStation: "大阪" });
  });
});
