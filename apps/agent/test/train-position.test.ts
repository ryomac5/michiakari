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

// 利用者が押した並び。目の前に詰まっているとみなす
function observed(trainsAhead: TrainPosition["trainsAhead"]): TrainPosition {
  return { ...defaults, trainsAhead, trainsAheadHeadwayMinutes: null };
}

describe("駅間の車内にいる利用者の判断", () => {
  it("既定値では、結論を次の駅に着いてからの行動で書き、理由の頭にふだんの間隔とみた見込みを置く", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(defaults)));
    expect(judgment.headline).toMatch(/^塚本(に着い|で降りて|でも降りずに)/);
    expect(judgment.headline).not.toMatch(/^あと\d+分/);
    expect(judgment.headline).not.toMatch(/まで待って/);
    expect(judgment.reason).toContain("前の列車との間隔はふだんどおりとみて");
    expect(judgment.reason).toMatch(/塚本に着くのは\d+時\d+分ごろの見込みです。/);
    expect(judgment.reason).not.toContain("入れない");
    expect(judgment.disclaimer).toContain("推定");
  });

  it("目の前の普通が次の駅に入ると、ホームがふさがっている事情を理由に書く", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(observed(["local"]))));
    expect(judgment.reason).toContain("塚本のホームに前の普通が止まっているため");
    expect(judgment.reason).toContain("再開のあと");
    expect(judgment.reason).not.toContain("入れない");
  });

  it("すぐ前の快速が次の駅に止まれなければ、その事情を理由に書く", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest(observed(["rapid", "local"]))));
    expect(judgment.reason).toContain("前の快速は塚本に止まれないため");
    expect(judgment.reason).toContain("塚本の手前で動けず");
    expect(judgment.reason).toContain("再開のあと");
    expect(judgment.reason).not.toContain("入れない");
  });

  it("自分が快速で次の駅に止まれなければ、降りる駅をその先の駅にする", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ ...observed([]), ownTrainType: "rapid" }, "尼崎")),
    );
    expect(judgment.headline).toMatch(/^尼崎/);
    expect(judgment.reason).toContain("快速は塚本に止まれないので");
  });

  it("前の列車が先に発車するぶんの遅れは、乗ったまま待つ側の到着にも足す", async () => {
    const none = findJudgment(await postJudge(app, buildRequest(observed([]))));
    const two = findJudgment(await postJudge(app, buildRequest(observed(["local", "local"]))));
    const waitArrival = (j: Judgment) =>
      Date.parse(j.options.find((o) => o.kind === "wait")?.arrivalTime ?? "");
    // 2 本ぶん、1 本あたり 3 分の 6 分だけ遅くなる
    expect(waitArrival(two) - waitArrival(none)).toBe(6 * 60_000);
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

describe("走行位置画像を判断へ反映する", () => {
  it("画像から読んだ快速・普通で既定の並びと間隔を置き換える", async () => {
    const request = buildRequest(defaults);
    request.observations.push({
      ...buildEntryObservation(),
      id: "cause",
      observedAt: now,
      eventTypeCandidates: [{ eventType: "person_accident", confidence: "high" }],
    });
    request.newInput = {
      type: "photo",
      imageBase64: "aGVsbG8=",
      mediaType: "image/png",
      fileName: "fixture-train-movement--rapid+local.png",
    };
    const events = await postJudge(app, request);
    const parsed = events.find((e) => e.type === "observation_parsed");
    expect(parsed?.type === "observation_parsed" && parsed.observation.trainsAhead).toEqual([
      "rapid",
      "local",
    ]);
    const actual = findJudgment(events);
    const expected = findJudgment(
      await postJudge(app, {
        ...request,
        newInput: null,
        trainPosition: observed(["rapid", "local"]),
      }),
    );
    expect(actual.reason).toBe(expected.reason);
    expect(actual.options).toEqual(expected.options);
    expect(actual.reason).toContain("前の快速は塚本に止まれないため");
    expect(actual.reason).not.toContain("前の列車との間隔はふだんどおりとみて");
  });

  it("過去の画像は利用者が手直しした並びを上書きしない", async () => {
    const request = buildRequest(observed(["local"]));
    request.observations.push({
      ...buildEntryObservation(),
      id: "old-photo",
      source: "photo",
      kind: "train_movement",
      trainsAhead: ["rapid", "local"],
    });
    const judgment = findJudgment(await postJudge(app, request));
    expect(judgment.reason).toContain("塚本のホームに前の普通が止まっているため");
  });
});
