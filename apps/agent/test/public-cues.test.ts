import { addMinutesToIso } from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  TrainPosition,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// 公開資料の調べから足した手がかりが、決定論モードの判断にどう効くかを確かめる
// 場面と文は架空。JR神戸線の大阪から三ノ宮へ向かう朝

const app = createTestApp(createTestDeps());
const now = "2026-11-06T08:40:00+09:00";

function buildObservation(input: {
  id: string;
  minutesAgo: number;
  rawText?: string;
  eventType?: string;
}): Observation {
  return {
    id: input.id,
    observedAt: addMinutesToIso(now, -input.minutesAgo),
    source: "text",
    ...(input.rawText ? { rawText: input.rawText } : {}),
    eventTypeCandidates: input.eventType
      ? [{ eventType: input.eventType, confidence: "high" }]
      : [],
    operator: "JR西日本",
    line: "JR神戸線",
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildRequest(observations: Observation[], trainPosition?: TrainPosition): JudgeRequest {
  return {
    observations,
    newInput: null,
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(trainPosition ? { trainPosition } : {}),
  };
}

async function judge(request: JudgeRequest): Promise<Judgment> {
  const events: JudgmentEvent[] = await postJudge(app, request);
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") {
    throw new Error(
      `judgment_ready が届きません: ${JSON.stringify(events.filter((e) => e.type === "error"))}`,
    );
  }
  return ready.judgment;
}

const betweenOsakaTsukamoto: TrainPosition = {
  kind: "between_stations",
  nextStation: "塚本",
  previousStation: "大阪",
  trainsAhead: [],
  trainsAheadCount: null,
  ownTrainType: "local",
  trainsAheadHeadwayMinutes: null,
};

describe("線路への降車の案内", () => {
  const evacuation = buildObservation({
    id: "evacuation",
    minutesAgo: 1,
    eventType: "person_collision",
    rawText:
      "人身事故のため運転を見合わせています。これから線路に降りて、最寄り駅まで歩いてご案内します。",
  });

  it("見込みの数字を出さず、係員の案内に従う結論にする", async () => {
    const judgment = await judge(buildRequest([evacuation]));
    expect(judgment.cues).toContain("evacuation_on_track");
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.unaffectedTrack).toBeUndefined();
    expect(judgment.action).toBe("hold");
    expect(judgment.headline).toBe("係員の案内に従う");
    expect(judgment.reason).not.toMatch(/\d{1,2}:\d{2}/);
    // 降りた後の選択肢は代替手段の計算に任せる
    expect(judgment.options.some((o) => o.kind !== "wait")).toBe(true);
  });

  it("駅間の車内でも係員の案内に従う結論にし、駅に着く時刻を出さない", async () => {
    const judgment = await judge(buildRequest([evacuation], betweenOsakaTsukamoto));
    expect(judgment.headline).toBe("係員の案内に従う");
    expect(judgment.inCar?.alightArrival ?? null).toBeNull();
  });

  it("降りないよう求める放送では、ふだんの判断のまま", async () => {
    const stay = buildObservation({
      id: "stay",
      minutesAgo: 1,
      eventType: "person_collision",
      rawText: "人身事故のため運転を見合わせています。線路には降りないでください。",
    });
    const judgment = await judge(buildRequest([stay]));
    expect(judgment.cues).not.toContain("evacuation_on_track");
    expect(judgment.headline).not.toBe("係員の案内に従う");
  });
});

describe("天気の事象の点検", () => {
  const text =
    "大雨の規制は解除されました。線路の点検を行っております。まもなく再開する見込みです。";

  it("大雨で点検が続く間は、まもなく再開の手がかりを判断に使わない", async () => {
    const rain = buildObservation({
      id: "rain",
      minutesAgo: 1,
      eventType: "heavy_rain",
      rawText: text,
    });
    const judgment = await judge(buildRequest([rain]));
    expect(judgment.cues).toContain("inspection_ongoing");
    expect(judgment.cues).not.toContain("resume_soon");
    expect(judgment.cues).not.toContain("track_cleared");
  });

  it("天気でない事象では、まもなく再開の手がかりを残す", async () => {
    const failure = buildObservation({
      id: "failure",
      minutesAgo: 1,
      eventType: "vehicle_failure",
      rawText: text,
    });
    const judgment = await judge(buildRequest([failure]));
    expect(judgment.cues).toContain("resume_soon");
  });
});

describe("地震の後に次の駅へ進む案内", () => {
  it("駅間の車内の人は、再開の前に次の駅に着く見込みになる", async () => {
    const quake = buildObservation({
      id: "quake",
      minutesAgo: 1,
      eventType: "earthquake",
      rawText: "地震のため停車しました。安全を確認した区間から、最寄り駅まで徐行で運転します。",
    });
    const without = buildObservation({
      id: "quake",
      minutesAgo: 1,
      eventType: "earthquake",
      rawText: "地震のため停車しました。",
    });
    const heard = await judge(buildRequest([quake], betweenOsakaTsukamoto));
    expect(heard.cues).toContain("proceed_to_station");
    expect(heard.inCar?.alightStation).toBe("塚本");
    // 前に列車がいないので、再開を待たずに塚本へ数分で着く
    const arrival = Date.parse(heard.inCar?.alightArrival ?? "");
    expect(arrival).toBeLessThanOrEqual(Date.parse(addMinutesToIso(now, 5)));
    // 案内が無ければ、再開を待ってから着くので遅くなる
    const plain = await judge(buildRequest([without], betweenOsakaTsukamoto));
    expect(Date.parse(plain.inCar?.alightArrival ?? "")).toBeGreaterThan(arrival);
  });
});

describe("降りる案内と再開の放送の前後", () => {
  const resumed = (minutesAgo: number) =>
    buildObservation({
      id: `resumed-${minutesAgo}`,
      minutesAgo,
      eventType: "person_collision",
      rawText: "運転を再開しました。",
    });
  const evacuation = (minutesAgo: number) =>
    buildObservation({
      id: `evacuation-${minutesAgo}`,
      minutesAgo,
      eventType: "person_collision",
      rawText: "これから線路に降りて、最寄り駅まで歩いてご案内します。",
    });

  it("再開の後に降りる案内が出たら、残り時間も分岐点の時刻も出さない", async () => {
    const judgment = await judge(buildRequest([resumed(10), evacuation(1)]));
    expect(judgment.cues).toContain("evacuation_on_track");
    expect(judgment.cues).not.toContain("resumed");
    expect(judgment.estimate.remaining).toBeNull();
    expect(judgment.breakEven).toBeNull();
    expect(judgment.headline).toBe("係員の案内に従う");
  });

  it("降りる案内より新しい観測で再開が告げられたら、再開を優先する", async () => {
    const judgment = await judge(buildRequest([evacuation(10), resumed(1)]));
    expect(judgment.cues).toContain("resumed");
    expect(judgment.cues).not.toContain("evacuation_on_track");
    expect(judgment.estimate.remaining).not.toBeNull();
    expect(judgment.headline).not.toBe("係員の案内に従う");
  });
});
