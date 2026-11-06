import { addMinutesToIso } from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  TrainPosition,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { findFlowWording } from "../src/domain/flow-wording.ts";
import { createTestApp, postJudge } from "./helpers.ts";

// 駅間の車内にいる利用者の判断。架空の夜に、駅と駅の間で止まった列車の中にいる
// 車内からは降りられない。結論は車内で待つだけにし、選択肢の一覧は空にする
// 次の駅に着いた後のほうが早い手段があるときだけ、着いた後の次の一手を 1 つ添える。駅にいる人の判断は変えない

const app = createTestApp();
const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

function buildEntryObservation(line = "JR神戸線"): Observation {
  return {
    id: "entry-line",
    observedAt: addMinutesToIso(now, -10),
    source: "selection",
    eventTypeCandidates: [],
    operator: "JR西日本",
    line,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

type RequestInput = {
  trainPosition: TrainPosition | null;
  origin?: string;
  destination?: string;
  eventType?: string;
  line?: string;
};

function buildRequest(input: RequestInput): JudgeRequest {
  const { trainPosition } = input;
  return {
    observations: [buildEntryObservation(input.line)],
    newInput: {
      type: "selection",
      eventType: input.eventType ?? "person_accident",
      signalIds: [],
    },
    origin: { kind: "station", name: input.origin ?? "塚本" },
    destination: { kind: "station", name: input.destination ?? "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(trainPosition ? { trainPosition } : {}),
  };
}

// 入口の既定値。大阪を出て塚本の手前で止まった。前の列車はふだんの間隔で先を走っていたとみなす
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

// 車内で待つ結論の共通の形。選択肢の一覧と境目は無く、推定である旨は残す
function expectInCarWait(judgment: Judgment): NonNullable<Judgment["inCar"]> {
  expect(judgment.action).toBe("wait");
  expect(judgment.options).toEqual([]);
  expect(judgment.recommendedOptionId).toBeNull();
  expect(judgment.breakEven).toBeNull();
  expect(judgment.busChecks).toBeUndefined();
  expect(judgment.headline).toMatch(/^車内で待つ/);
  expect(judgment.headline).not.toMatch(/乗り換え|タクシー|降りて|まで待って|あと\d+分/);
  expect(judgment.reason ?? "").not.toMatch(/乗り換え|タクシー|境目|入れない/);
  expect(judgment.disclaimer).toContain("推定");
  expect(judgment.disclaimer).toContain("公式発表");
  const inCar = judgment.inCar;
  if (!inCar) throw new Error("車内の案内がありません");
  expect(inCar.staffNote).toBe("長く止まったときは、係員の案内に従ってください。");
  return inCar;
}

describe("駅間の車内の 3 つの場面", () => {
  it("福島〜大阪の間で行き先が大阪なら、車内で待ち、動く時刻を見出しに出し、着いた後の次の一手も出さない", async () => {
    const position: TrainPosition = {
      ...observed([]),
      previousStation: "福島",
      nextStation: "大阪",
    };
    const judgment = findJudgment(
      await postJudge(
        app,
        buildRequest({
          trainPosition: position,
          origin: "大阪",
          destination: "大阪",
          eventType: "in_car_response",
          line: "JR大阪環状線",
        }),
      ),
    );
    const inCar = expectInCarWait(judgment);
    expect(judgment.headline).toMatch(/^車内で待つ。動くのは\d+時\d+分ごろの見込み$/);
    expect(inCar.alightStation).toBe("大阪");
    expect(inCar.departure).not.toBeNull();
    expect(inCar.afterAlight).toBeNull();
    expect(judgment.reason).toMatch(/大阪には.*\d+時\d+分ごろに着く見込みです。/);
  });

  it("行き先が次の駅の先の別の路線で、着いた後のほうが早ければ、着いた後の次の一手を 1 つ添える", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed([]), destination: "西宮北口" })),
    );
    const inCar = expectInCarWait(judgment);
    const step = inCar.afterAlight;
    if (!step) throw new Error("着いた後の次の一手がありません");
    expect(step.kind).toBe("transfer");
    expect(step.text).toMatch(/^塚本に着いたら.+へ$/);
    expect(step.line).not.toBe("JR神戸線");
    // 次の一手は、次の駅に着く見込みの時刻より後に着く
    expect(Date.parse(step.arrivalTime)).toBeGreaterThan(Date.parse(inCar.alightArrival ?? now));
  });

  it("人身事故で長く止まっても、乗ったままで行き先に着けるなら、車内で待つだけで次の一手も出さない", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({ trainPosition: defaults })));
    const inCar = expectInCarWait(judgment);
    expect(inCar.afterAlight).toBeNull();
    // 理由は着く見込みだけにし、再開までの時間を事象の流れとして言い切らない
    expect(judgment.reason).toMatch(/^塚本には\d{1,2}時\d{2}分ごろに着く見込みです。/);
    expect(findFlowWording(judgment.reason ?? "", "ja")).toBeNull();
    expect(judgment.typicalFlow).toBeDefined();
  });
});

describe("駅間の車内にいる利用者の理由", () => {
  it("再開の前に次の駅まで進めるときも、見出しは列車が動く時刻を示す", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed([]) })),
    );
    const inCar = expectInCarWait(judgment);
    expect(judgment.reason).not.toContain("再開後");
    expect(inCar.departure).not.toBeNull();
    expect(judgment.headline).toMatch(/^車内で待つ。動くのは\d+時\d+分ごろの見込み$/);
  });

  it("既定値では、理由の頭に着く見込みを置き、間隔の仮定は前提のチップに任せる", async () => {
    const judgment = findJudgment(await postJudge(app, buildRequest({ trainPosition: defaults })));
    expect(judgment.reason).toMatch(/^塚本には\d+時\d+分ごろに着く見込みです。/);
    expect(judgment.reason).not.toMatch(/仮定|ふだん/);
  });

  it("目の前の普通が次の駅に入ると、ホームがふさがっている事情を理由に書く", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed(["local"]) })),
    );
    expect(judgment.reason).toContain("塚本のホームに前の普通が止まっています");
    expect(judgment.reason).toContain("再開後");
    expect(judgment.reason).not.toContain("入れない");
    expect(judgment.headline).toMatch(/^車内で待つ。動くのは\d+時\d+分ごろの見込み$/);
  });

  it("すぐ前の快速が次の駅に止まれなければ、その事情を理由に書く", async () => {
    const judgment = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed(["rapid", "local"]) })),
    );
    expect(judgment.reason).toContain("前の快速は塚本に止まれず");
    expect(judgment.reason).toContain("手前で止まっています");
    expect(judgment.reason).toContain("再開後");
    expect(judgment.reason).not.toContain("入れない");
  });

  it("自分が快速で次の駅に止まれなければ、降りる駅をその先の駅にする", async () => {
    const judgment = findJudgment(
      await postJudge(
        app,
        buildRequest({ trainPosition: { ...observed([]), ownTrainType: "rapid" }, origin: "尼崎" }),
      ),
    );
    const inCar = expectInCarWait(judgment);
    expect(inCar.alightStation).toBe("尼崎");
    expect(judgment.reason).toContain("快速は塚本に止まれません");
  });

  it("前の列車が先に発車するぶんの遅れは、自分の列車が動き出す見込みに足す", async () => {
    // どちらも次の駅のホームがふさがっていて、再開を待ってから動く
    const one = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed(["local"]) })),
    );
    const three = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: observed(["local", "local", "local"]) })),
    );
    const departure = (j: Judgment) => Date.parse(j.inCar?.departure ?? "");
    // 2 本ぶん、1 本あたり 3 分の 6 分だけ遅くなる
    expect(departure(three) - departure(one)).toBe(6 * 60_000);
  });

  it("選択肢の一覧と境目は、途中のイベントでも画面へ送らない", async () => {
    const events = await postJudge(app, buildRequest({ trainPosition: defaults }));
    const computed = events.find((e) => e.type === "alternatives_computed");
    expect(computed?.type === "alternatives_computed" && computed.options).toEqual([]);
    const breakEven = events.find((e) => e.type === "break_even_computed");
    expect(breakEven?.type === "break_even_computed" && breakEven.breakEven).toBeNull();
  });

  it("駅にいる人と、駅に止まっている車内の人の判断は、位置を付けないときと同じ", async () => {
    const plain = findJudgment(
      await postJudge(app, buildRequest({ trainPosition: null, origin: "大阪" })),
    );
    expect(plain.options.length).toBeGreaterThan(0);
    expect(plain.inCar).toBeUndefined();
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
      const judgment = findJudgment(
        await postJudge(app, buildRequest({ trainPosition: position, origin: "大阪" })),
      );
      expect(judgment.headline).toBe(plain.headline);
      expect(judgment.reason).toBe(plain.reason);
      expect(judgment.action).toBe(plain.action);
      expect(judgment.options).toEqual(plain.options);
      expect(judgment.inCar).toBeUndefined();
    }
  });
});

describe("走行位置画像を判断へ反映する", () => {
  it("画像から読んだ快速・普通で既定の並びと間隔を置き換える", async () => {
    const request = buildRequest({ trainPosition: defaults });
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
    expect(actual.inCar).toEqual(expected.inCar);
    expect(actual.reason).toContain("前の快速は塚本に止まれず");
    expect(actual.reason).not.toContain("前の列車との間隔はふだんどおりと仮定");
  });

  it("過去の画像は利用者が手直しした並びを上書きしない", async () => {
    const request = buildRequest({ trainPosition: observed(["local"]) });
    request.observations.push({
      ...buildEntryObservation(),
      id: "old-photo",
      source: "photo",
      kind: "train_movement",
      trainsAhead: ["rapid", "local"],
    });
    const judgment = findJudgment(await postJudge(app, request));
    expect(judgment.reason).toContain("塚本のホームに前の普通が止まっています");
  });
});
