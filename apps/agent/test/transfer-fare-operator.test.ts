import type { JudgeRequest, Observation, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import type { AlternativesProvider } from "../src/alternatives/provider.ts";
import { runFindAlternatives } from "../src/tools/find-alternatives.ts";
import type { EstimateToolResult, ToolContext } from "../src/tools/types.ts";

// 振替の費用に使う止まった路線の事業者は、観測か止まった路線の名前から取る。待つ経路の最初の乗車からは取らない

const now = "2026-11-05T22:00:00+09:00";

function ride(lineId: string): RouteOption["legs"][number] {
  return { mode: "ride", from: "A", to: "B", minutes: 10, lineId };
}

function buildOption(id: string, kind: RouteOption["kind"], lineIds: string[]): RouteOption {
  return {
    id,
    kind,
    label: id,
    legs: lineIds.map(ride),
    arrivalTime: "2026-11-05T22:40:00+09:00",
    fareYen: null,
    walkMinutes: 0,
    isTransferService: false,
  };
}

// 待つ経路は阪急に乗ってから止まっている JR に乗り継ぐ。最初の乗車は止まっている路線ではない
const options = [
  buildOption("wait", "wait", ["hankyu.神戸線", "jr-west.東海道線"]),
  buildOption("hankyu", "transfer", ["hankyu.神戸線"]),
];

function buildObservation(operator: string | null, line: string | null): Observation {
  return {
    id: "obs",
    observedAt: "2026-11-05T21:50:00+09:00",
    source: "selection",
    eventTypeCandidates: [],
    operator,
    line,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildContext(observations: Observation[]): ToolContext {
  const provider = {
    findAlternatives: async () => ({
      options,
      waitOptionId: "wait",
      waitRouteMinutesAfterResume: 30,
      notes: [],
    }),
    listLines: () => [{ name: "JR神戸線", operator: "JR西日本" }],
  } as unknown as AlternativesProvider;
  const request = {
    observations,
    newInput: null,
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ticketType: "ic",
  } as unknown as JudgeRequest;
  return { request, observations, provider } as unknown as ToolContext;
}

const estimate = {
  estimate: { remaining: { p50: 30, p80: 60 } },
  trainQueue: null,
  firstTrainWait: null,
  protection: false,
} as unknown as EstimateToolResult;

async function findHankyuFare(observations: Observation[]) {
  const result = await runFindAlternatives(buildContext(observations), estimate, {});
  return result.options.find((o) => o.id === "hankyu")?.transferFare;
}

describe("振替の費用に使う止まった路線の事業者", () => {
  it("観測の事業者を使い、待つ経路の最初の乗車の阪急を止まった会社とみなさない", async () => {
    expect(await findHankyuFare([buildObservation("JR西日本", "JR神戸線")])).toBe("fare_required");
  });

  it("観測に事業者が無ければ、止まった路線の名前から事業者を引く", async () => {
    expect(await findHankyuFare([buildObservation(null, "JR神戸線")])).toBe("fare_required");
  });

  it("どちらからも引けなければ決めない", async () => {
    expect(await findHankyuFare([buildObservation(null, null)])).toBeUndefined();
  });
});

describe("振替先の事業者を書いたいちばん新しい発表", () => {
  // 定期券で、振替先の無い発表と、阪急と阪神を書いた発表を同じ秒に続けて貼った
  function buildAnnouncement(id: string, operators: string[]): Observation {
    return {
      ...buildObservation("JR西日本", "JR神戸線"),
      id,
      source: "text",
      transferServiceActive: true,
      transferOperators: operators,
    };
  }

  async function findPassFare(observations: Observation[]) {
    const ctx = buildContext(observations);
    ctx.request.ticketType = "commuter_pass";
    const result = await runFindAlternatives(ctx, estimate, {});
    return result.options.find((o) => o.id === "hankyu")?.transferFare;
  }

  it("同じ時刻の発表は、後ろに並ぶ発表の振替先を使う", async () => {
    const first = buildAnnouncement("obs_3", []);
    const second = buildAnnouncement("obs_4", ["hankyu", "hanshin"]);
    expect(await findPassFare([first, second])).toBe("covered");
    expect(await findPassFare([second, first])).toBe("possibly_covered");
  });
});
