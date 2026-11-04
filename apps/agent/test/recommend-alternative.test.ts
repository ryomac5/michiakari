import { addMinutesToIso } from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  TrainPosition,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createGeoProvider } from "../src/alternatives/geo-provider.ts";
import type { AlternativesProvider } from "../src/alternatives/provider.ts";
import { computeBreakEvenForOptions } from "../src/domain/break-even.ts";
import { createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// 勧める代替手段の決まり。タクシーは、鉄道の代替が無いときと、鉄道の代替では期限に間に合わないときだけ勧める
// 駅間の車内の既定の流れ（大阪を出て塚本の手前で止まった夜）で確かめる

const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

function buildEntryObservation(): Observation {
  return {
    id: "entry-line",
    observedAt: addMinutesToIso(now, -10),
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line: "JR神戸線",
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

// 入口の既定値。前の列車は運転パターンから推し量った並びで、ふだんの間隔で先を走っていたとみなす
const defaults: TrainPosition = {
  kind: "between_stations",
  nextStation: "塚本",
  previousStation: "大阪",
  trainsAhead: ["local", "local", "local"],
  trainsAheadCount: null,
  ownTrainType: "local",
  trainsAheadHeadwayMinutes: 7.5,
};

function buildRequest(deadline: string | null = null): JudgeRequest {
  return {
    observations: [buildEntryObservation()],
    newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    trainPosition: defaults,
  };
}

// 鉄道の代替を取り除いた探索。塚本から三ノ宮へ待つ選択肢とタクシーだけが残る
function withoutRail(provider: AlternativesProvider): AlternativesProvider {
  return {
    ...provider,
    async findAlternatives(query) {
      const result = await provider.findAlternatives(query);
      return {
        ...result,
        options: result.options.filter((o) => o.kind === "wait" || o.kind === "taxi"),
      };
    },
  };
}

const provider = createGeoProvider();
const app = createTestApp();

function recommendedOf(judgment: Judgment) {
  return judgment.options.find((o) => o.id === judgment.recommendedOptionId);
}

describe("塚本から三ノ宮への判断: 鉄道の代替がある", () => {
  it("代替手段に、徒歩で別の鉄道の駅へ行く経路が入り、タクシーも運賃つきで並ぶ", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest()));
    const rails = judgment.options.filter((o) => o.kind === "transfer");
    expect(rails.length).toBeGreaterThan(0);
    for (const option of rails) {
      expect(option.legs[0]?.mode).toBe("walk");
      expect(option.legs.some((l) => l.mode === "ride")).toBe(true);
    }
    const taxi = judgment.options.find((o) => o.kind === "taxi");
    expect(taxi?.fareYen).toBeGreaterThan(0);
  });

  it("タクシーのほうが早く着いても、期限が無ければタクシーを勧めず、見出しにもタクシーを出さない", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest()));
    const taxi = judgment.options.find((o) => o.kind === "taxi");
    const rails = judgment.options.filter((o) => o.kind === "transfer");
    const fastestRail = Math.min(...rails.map((o) => Date.parse(o.arrivalTime)));
    expect(Date.parse(taxi?.arrivalTime ?? "")).toBeLessThan(fastestRail);
    expect(judgment.action).toBe("switch");
    expect(recommendedOf(judgment)?.kind).toBe("transfer");
    expect(judgment.headline).not.toContain("タクシー");
    expect(judgment.reason ?? "").not.toContain("タクシー");
  });

  it("分岐点は、勧める鉄道の代替の到着時刻で求める", async () => {
    const withRail = findJudgment(await postJudge(app, buildRequest()));
    const noRailApp = createTestApp(createTestDeps({ provider: withoutRail(provider) }));
    const taxiOnly = findJudgment(await postJudge(noRailApp, buildRequest()));
    const railArrival = Date.parse(recommendedOf(withRail)?.arrivalTime ?? "");
    const taxiArrival = Date.parse(recommendedOf(taxiOnly)?.arrivalTime ?? "");
    expect(railArrival).toBeGreaterThan(taxiArrival);
    // 分岐点 = 勧める代替手段の到着 − 再開後の乗車 − 初列車待ち。引く分は同じなので、差は到着の差に等しい
    const railBreakEven = Date.parse(withRail.breakEven?.time ?? "");
    const taxiBreakEven = Date.parse(taxiOnly.breakEven?.time ?? "");
    expect(railBreakEven - taxiBreakEven).toBe(railArrival - taxiArrival);
  });

  it("鉄道の代替が期限に間に合うなら、タクシーのほうが早くても鉄道の代替を勧める", async () => {
    const base = findJudgment(await postJudge(app, buildRequest()));
    const rail = base.options.find((o) => o.kind === "transfer");
    const deadline = addMinutesToIso(rail?.arrivalTime ?? now, 5);
    const judgment = findJudgment(await postJudge(app, buildRequest(deadline)));
    expect(recommendedOf(judgment)?.kind).toBe("transfer");
    expect(judgment.headline).not.toContain("タクシー");
  });
});

describe("塚本から三ノ宮への判断: タクシーを勧める", () => {
  it("鉄道の代替が無ければ、タクシーを勧める。運賃は選択肢に残る", async () => {
    const noRail = createTestApp(createTestDeps({ provider: withoutRail(provider) }));
    const judgment = findJudgment(await postJudge(noRail, buildRequest()));
    expect(judgment.options.map((o) => o.kind).sort()).toEqual(["taxi", "wait"]);
    expect(judgment.action).toBe("switch");
    expect(recommendedOf(judgment)?.kind).toBe("taxi");
    expect(judgment.headline).toContain("タクシー");
    expect(recommendedOf(judgment)?.fareYen).toBeGreaterThan(0);
  });

  it("鉄道の代替では期限に間に合わず、タクシーなら間に合うときは、タクシーを勧める", async () => {
    const base = findJudgment(await postJudge(app, buildRequest()));
    const taxi = base.options.find((o) => o.kind === "taxi");
    const rail = base.options.find((o) => o.kind === "transfer");
    // 期限をタクシーの到着の 1 分後に置く。鉄道の代替はそれより遅く着く
    const deadline = addMinutesToIso(taxi?.arrivalTime ?? now, 1);
    expect(Date.parse(rail?.arrivalTime ?? "")).toBeGreaterThan(Date.parse(deadline));
    const judgment = findJudgment(await postJudge(app, buildRequest(deadline)));
    expect(judgment.action).toBe("switch");
    expect(recommendedOf(judgment)?.kind).toBe("taxi");
    expect(judgment.headline).toContain("タクシー");
    expect(judgment.options.some((o) => o.kind === "transfer")).toBe(true);
  });

  it("鉄道の代替もタクシーも期限に間に合わないときは、鉄道の代替を勧める", async () => {
    const base = findJudgment(await postJudge(app, buildRequest()));
    const taxi = base.options.find((o) => o.kind === "taxi");
    const deadline = addMinutesToIso(taxi?.arrivalTime ?? now, -5);
    const judgment = findJudgment(await postJudge(app, buildRequest(deadline)));
    expect(recommendedOf(judgment)?.kind).not.toBe("taxi");
  });
});

describe("computeBreakEvenForOptions", () => {
  const option = (id: string, kind: "transfer" | "taxi", arrival: string) => ({
    id,
    kind,
    label: id,
    legs: [
      {
        mode: kind === "taxi" ? ("taxi" as const) : ("ride" as const),
        from: "a",
        to: "b",
        minutes: 30,
      },
    ],
    arrivalTime: arrival,
    fareYen: kind === "taxi" ? 15000 : null,
    walkMinutes: 0,
    isTransferService: false,
  });
  const base = {
    now,
    remaining: { p50: 30, p80: 50 },
    waitRouteMinutesAfterResume: 20,
    firstTrainWaitMinutes: 5,
  };
  const options = [
    option("transfer_1", "transfer", "2026-11-05T23:30:00+09:00"),
    option("taxi", "taxi", "2026-11-05T23:10:00+09:00"),
  ];

  it("勧める代替手段の id を分岐点の計算に使った代替手段として返し、比較表にはタクシーも並べる", () => {
    const computed = computeBreakEvenForOptions({ ...base, options, deadline: null });
    expect(computed.basisOptionIds).toEqual(["transfer_1"]);
    expect(computed.result).toMatchObject({ kind: "future", bestAlternativeId: "transfer_1" });
    expect(computed.comparison.map((c) => c.optionId)).toContain("taxi");
  });

  it("期限に間に合うのがタクシーだけなら、タクシーで分岐点を求める", () => {
    const computed = computeBreakEvenForOptions({
      ...base,
      options,
      deadline: "2026-11-05T23:20:00+09:00",
    });
    expect(computed.basisOptionIds).toEqual(["taxi"]);
    expect(computed.result).toMatchObject({ kind: "future", bestAlternativeId: "taxi" });
  });

  it("代替手段が無ければ分岐点は無い", () => {
    const computed = computeBreakEvenForOptions({ ...base, options: [], deadline: null });
    expect(computed.result).toEqual({ kind: "no_alternative" });
    expect(computed.basisOptionIds).toEqual([]);
  });
});
