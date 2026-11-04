import { addMinutesToIso } from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  TrainPosition,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createTestApp, postJudge } from "./helpers.ts";

// 駅間の車内にいる利用者の判断。大阪を出て塚本の手前で止まった架空の夜
// 結論は次の駅に着いてからの行動で書き、「あと N 分」の形にしない。駅にいる人の判断は変えない

const app = createTestApp();
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

function buildRequest(trainPosition: TrainPosition | null, origin = "塚本"): JudgeRequest {
  return {
    observations: [buildEntryObservation()],
    newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
    origin: { kind: "station", name: origin },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(trainPosition ? { trainPosition } : {}),
  };
}

const between: TrainPosition = {
  kind: "between_stations",
  nextStation: "塚本",
  previousStation: "大阪",
  trainsAhead: ["local", "local", "local"],
  trainsAheadCount: null,
  ownTrainType: "local",
};

describe("駅間の車内にいる利用者の判断", () => {
  it("結論は次の駅に着いてからの行動で書き、理由の頭に次の駅に着く見込みを置く", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(between)));
    expect(judgment.headline).toMatch(/^塚本(に着い|で降りて|でも降りずに)/);
    expect(judgment.headline).not.toMatch(/^あと\d+分/);
    expect(judgment.headline).not.toMatch(/まで待って/);
    expect(judgment.reason).toMatch(/塚本に着くのは.*\d+時\d+分ごろの見込みです。/);
    expect(judgment.disclaimer).toContain("推定");
  });

  it("すぐ前の快速が次の駅に入れなければ、理由に種別の事情を入れる", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ ...between, trainsAhead: ["rapid", "local"] })),
    );
    expect(judgment.reason).toContain("前の快速が塚本に入れないため");
    expect(judgment.reason).toContain("再開のあと");
  });

  it("自分が快速で次の駅に止まれなければ、降りる駅をその先の駅にする", async () => {
    const judgment = findJudgment(
      await postJudge(
        app,
        buildRequest({ ...between, ownTrainType: "rapid", trainsAhead: [] }, "尼崎"),
      ),
    );
    expect(judgment.headline).toMatch(/^尼崎/);
    expect(judgment.reason).toContain("快速は塚本に止まれないので");
  });

  it("駅にいる人と、駅に止まっている車内の人の判断は、位置を付けないときと同じ", async () => {
    const plain = findJudgment(await postJudge(app, buildRequest(null, "大阪")));
    const atStation: TrainPosition = {
      kind: "at_station",
      nextStation: null,
      previousStation: null,
      trainsAhead: null,
      trainsAheadCount: null,
      ownTrainType: null,
    };
    const stopped = { ...atStation, kind: "on_train_at_station" as const };
    for (const position of [atStation, stopped]) {
      const judgment = findJudgment(await postJudge(app, buildRequest(position, "大阪")));
      expect(judgment.headline).toBe(plain.headline);
      expect(judgment.reason).toBe(plain.reason);
      expect(judgment.action).toBe(plain.action);
    }
  });
});
