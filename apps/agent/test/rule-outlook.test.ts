import {
  addMinutesToIso,
  detectAnnouncementCues,
  detectObservationCues,
  findLineOperatorKey,
} from "@repo/core";
import type {
  JudgeRequest,
  Judgment,
  JudgmentEvent,
  Observation,
  RouteOption,
  TrainPosition,
} from "@repo/schema";
import { describe, expect, it } from "vitest";
import type { AlternativesProvider } from "../src/alternatives/provider.ts";
import { interpretSelection } from "../src/interpret/deterministic-interpret.ts";
import {
  assembleJudgment,
  checkStopReasonShares,
  extractTextNumbers,
} from "../src/judge/assemble.ts";
import { createEventSink } from "../src/judge/event-sink.ts";
import { createJudgeSession } from "../src/judge/session.ts";
import { runComputeBreakEven } from "../src/tools/compute-break-even.ts";
import { runEstimateRemaining } from "../src/tools/estimate-remaining.ts";
import { runFindAlternatives } from "../src/tools/find-alternatives.ts";
import type { ToolContext } from "../src/tools/types.ts";
import { createTestApp, createTestDeps, postJudge } from "./helpers.ts";

// 元指令員の経験から作った規則 2〜5 を、決定論モードの判断で確かめる
// 2 は受信の放送、3 は支障の無い線路、4 は乗り換え先の並べ方、5 は再開後の詰まり
// 時刻と場面は架空。JR神戸線の大阪から三ノ宮へ向かう夜

const deps = createTestDeps();
const app = createTestApp(deps);
const now = "2026-11-06T20:40:00+09:00";

// 入口で受信の問いに「あった」と答えたときに画面が作る観測
const PROTECTION_TEXT = "危険を知らせる信号を受信したため、緊急停止しました";

function buildObservation(input: {
  id: string;
  minutesAgo: number;
  rawText?: string;
  eventType?: string;
  operator?: string;
  line?: string;
  statedResumeTime?: string | null;
  kind?: Observation["kind"];
}): Observation {
  return {
    id: input.id,
    observedAt: addMinutesToIso(now, -input.minutesAgo),
    source: "selection",
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.rawText ? { rawText: input.rawText } : {}),
    eventTypeCandidates: input.eventType
      ? [{ eventType: input.eventType, confidence: "high" }]
      : [],
    operator: input.operator ?? "JR西日本",
    line: input.line ?? "JR神戸線",
    section: null,
    statedResumeTime: input.statedResumeTime ?? null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

function buildRequest(
  observations: Observation[],
  options: {
    trainPosition?: TrainPosition;
    origin?: string;
    destination?: string;
    protectionBroadcast?: JudgeRequest["protectionBroadcast"];
  } = {},
): JudgeRequest {
  return {
    observations,
    newInput: null,
    origin: { kind: "station", name: options.origin ?? "大阪" },
    destination: { kind: "station", name: options.destination ?? "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    ...(options.trainPosition ? { trainPosition: options.trainPosition } : {}),
    ...(options.protectionBroadcast ? { protectionBroadcast: options.protectionBroadcast } : {}),
  };
}

async function judge(
  request: JudgeRequest,
): Promise<{ judgment: Judgment; events: JudgmentEvent[] }> {
  const events = await postJudge(app, request);
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return { judgment: ready.judgment, events };
}

const protectionHeard = buildObservation({
  id: "entry-protection",
  minutesAgo: 5,
  kind: "station_broadcast",
  rawText: PROTECTION_TEXT,
});
const personCollision = buildObservation({
  id: "entry-cause",
  minutesAgo: 5,
  eventType: "person_collision",
});

// 駅で聞いた詰まりの放送
const queueObservation = buildObservation({
  id: "queue",
  minutesAgo: 1,
  kind: "station_broadcast",
  rawText: "前の列車がつかえているため、再開後もこの列車はしばらく停車いたします。",
});

// 乗る路線の事業者キー。乗らない選択肢は null
function listRideOperators(option: RouteOption): string[] {
  return option.legs.flatMap((leg) => {
    const key = leg.mode === "ride" ? findLineOperatorKey(leg.lineId ?? null) : null;
    return key ? [key] : [];
  });
}

describe("規則 2: 受信の放送", () => {
  it("入口の受信の観測は、種類と出どころを問わず原文から手がかりを拾う", () => {
    expect(detectAnnouncementCues(PROTECTION_TEXT)).toEqual(["protection_received"]);
    expect(detectObservationCues([protectionHeard])).toEqual(["protection_received"]);
  });

  it("原因の発表が無くても、防護無線の事象とみなし、手がかりと根拠と支障の無い線路の見込みを載せる", async () => {
    const { judgment, events } = await judge(buildRequest([protectionHeard]));
    expect(judgment.estimate.eventType).toBeNull();
    expect(judgment.cues).toEqual(["protection_received"]);
    expect(judgment.protection).toBe(true);
    expect(judgment.evidence).toContainEqual(
      expect.objectContaining({ kind: "cue", id: "protection_received" }),
    );
    // 当該の線路の見込みは立たないが、反対の線路は確かめが済めば先に動く
    expect(judgment.unaffectedTrack).toEqual({
      trackSide: "unknown",
      affected: null,
      opposite: { p50: 5, p80: 10 },
    });
    // 原因が分からないので、境目まで待って動かなければ切り替える
    expect(judgment.action).toBe("hold");
    const estimated = events.find((e) => e.type === "phase_estimated");
    expect(estimated).toMatchObject({ protection: true, cues: ["protection_received"] });
  });

  it("受信の放送が無く防護無線を出さない種類なら、防護無線の欄は偽で支障の無い線路の見込みを載せない", async () => {
    const failure = buildObservation({ id: "entry", minutesAgo: 5, eventType: "vehicle_failure" });
    const { judgment } = await judge(buildRequest([failure]));
    expect(judgment.protection).toBe(false);
    expect(judgment.cues).toEqual([]);
    expect(judgment.unaffectedTrack).toBeUndefined();
  });
});

describe("規則 3: 支障の無い線路", () => {
  it("どちら側か分からなければ、当該の線路と反対の線路の両方の見込みを並べる", async () => {
    const { judgment } = await judge(buildRequest([personCollision]));
    const track = judgment.unaffectedTrack;
    if (!track) throw new Error("支障の無い線路の見込みがありません");
    expect(track.trackSide).toBe("unknown");
    // 反対の線路は発生から 10〜15 分ほどの目安で、経過の 5 分を引く
    expect(track.opposite).toEqual({ p50: 5, p80: 10 });
    // 当該の線路は長く止まる。反対の線路より後に動く
    expect(track.affected?.p50).toBeGreaterThan(track.opposite?.p80 ?? 0);
    expect(judgment.evidence).toContainEqual(
      expect.objectContaining({ kind: "computation", id: "unaffected_track" }),
    );
    // 人身事故は長く止まる種類なので、境目まで時間があっても切り替える
    expect(judgment.action).toBe("switch");
  });
});

describe("規則 4: 乗り換え先の並べ方", () => {
  it("防護無線の事象では、待つ選択肢を先頭に残し、他社の線を上げ、同じ会社の線を下げて勧めない", async () => {
    const { judgment } = await judge(buildRequest([personCollision]));
    const [first, ...rest] = judgment.options;
    expect(first?.kind).toBe("wait");
    const rails = rest.filter((o) => listRideOperators(o).length > 0);
    const isSameCompany = (o: RouteOption) => listRideOperators(o).includes("jr-west");
    // 同じ会社の線は、他社の線より後ろに並ぶ
    const lastOther = rails.findLastIndex((o) => !isSameCompany(o));
    const firstSame = rails.findIndex(isSameCompany);
    if (firstSame >= 0) expect(firstSame).toBeGreaterThan(lastOther);
    const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
    if (!recommended) throw new Error("勧める選択肢がありません");
    expect(isSameCompany(recommended)).toBe(false);
    expect(listRideOperators(recommended).length).toBeGreaterThan(0);
  });

  // 同じ会社の並ぶ線がいちばん早く着く架空の選択肢。防護無線の事象では最初は一緒に止まる
  function buildRide(id: string, lineId: string, arrivalMinutes: number): RouteOption {
    return {
      id,
      kind: id === "wait" ? "wait" : "transfer",
      label: id,
      legs: [{ mode: "ride", from: "大阪", to: "三ノ宮", minutes: 30, lineId }],
      arrivalTime: addMinutesToIso(now, arrivalMinutes),
      fareYen: 400,
      walkMinutes: 0,
      isTransferService: false,
    };
  }
  const stubOptions = [
    buildRide("wait", "jr-west.東海道線", 120),
    buildRide("jr_parallel", "jr-west.福知山線", 40),
    buildRide("hanshin", "hanshin.本線", 55),
  ];

  function estimateWithStub(observations: Observation[]) {
    const provider: AlternativesProvider = {
      ...deps.provider,
      findAlternatives: async () => ({
        options: stubOptions,
        waitOptionId: "wait",
        waitRouteMinutesAfterResume: 30,
        notes: [],
      }),
    };
    const request = buildRequest(observations);
    const ctx: ToolContext = {
      request,
      observations,
      content: deps.content,
      provider,
      scenario: null,
      fetchRain: deps.fetchRain,
    };
    const estimate = runEstimateRemaining(ctx, {
      eventType: observations[0]?.eventTypeCandidates[0]?.eventType ?? null,
    });
    return { ctx, estimate };
  }

  it("同じ会社の並ぶ線がいちばん早くても、防護無線の事象では後ろに下げ、勧める先に選ばない", async () => {
    const { ctx, estimate } = estimateWithStub([personCollision]);
    expect(estimate.protection).toBe(true);
    const alternatives = await runFindAlternatives(ctx, estimate, {});
    expect(alternatives.options.map((o) => o.id)).toEqual(["wait", "hanshin", "jr_parallel"]);
    expect(alternatives.loweredOptionIds).toEqual(["jr_parallel"]);
    const breakEven = runComputeBreakEven(ctx, estimate, alternatives);
    if (breakEven.result.kind !== "future" && breakEven.result.kind !== "passed")
      throw new Error("境目がありません");
    expect(breakEven.result.bestAlternativeId).toBe("hanshin");
    // 比較表には下げた線も残す
    expect(breakEven.comparison.map((c) => c.optionId)).toContain("jr_parallel");
  });

  it("防護無線の事象でなければ、同じ会社の並ぶ線も下げず、早ければ勧める", async () => {
    const failure = buildObservation({ id: "entry", minutesAgo: 5, eventType: "vehicle_failure" });
    const { ctx, estimate } = estimateWithStub([failure]);
    const alternatives = await runFindAlternatives(ctx, estimate, {});
    expect(alternatives.options.map((o) => o.id)).toEqual(["wait", "jr_parallel", "hanshin"]);
    expect(alternatives.loweredOptionIds).toBeUndefined();
    const breakEven = runComputeBreakEven(ctx, estimate, alternatives);
    if (breakEven.result.kind !== "future" && breakEven.result.kind !== "passed")
      throw new Error("境目がありません");
    expect(breakEven.result.bestAlternativeId).toBe("jr_parallel");
  });

  it("防護無線の事象でなければ、並びを変えない", async () => {
    const failure = buildObservation({ id: "entry", minutesAgo: 5, eventType: "vehicle_failure" });
    const ranked = await judge(buildRequest([personCollision]));
    const plain = await judge(buildRequest([failure]));
    expect(plain.judgment.options[0]?.kind).toBe("wait");
    expect(new Set(plain.judgment.options.map((o) => o.id))).toEqual(
      new Set(ranked.judgment.options.map((o) => o.id)),
    );
  });
});

describe("規則 5: 再開後の詰まり", () => {
  const queueText = "前の列車がつかえているため、再開後もこの列車はしばらく停車いたします。";
  const statedSoon = addMinutesToIso(now, 10);

  it("駅で詰まりの放送を聞いたら、再開が近くても待たずに他社の線へ切り替える", async () => {
    const queue = buildObservation({
      id: "queue",
      minutesAgo: 1,
      kind: "station_broadcast",
      rawText: queueText,
      statedResumeTime: statedSoon,
    });
    const { judgment } = await judge(buildRequest([personCollision, queue]));
    expect(judgment.cues).toContain("queue_ahead");
    expect(judgment.resumeQueue).toMatchObject({
      closesUp: true,
      queueAnnounced: true,
      worthAlightingAtNextStation: true,
    });
    expect(judgment.resumeQueue?.trainsInQueue).toBeGreaterThan(0);
    expect(judgment.action).toBe("switch");
    expect(judgment.reason).toMatch(/^再開しても前の列車が詰まって進みにくい見込みです。/);
    expect(judgment.evidence).toContainEqual(
      expect.objectContaining({ kind: "cue", id: "queue_ahead" }),
    );
    expect(judgment.evidence).toContainEqual(
      expect.objectContaining({ kind: "computation", id: "resume_queue" }),
    );
  });

  it("詰まりの放送が無ければ、再開が近いので待つ", async () => {
    const stated = buildObservation({
      id: "stated",
      minutesAgo: 1,
      statedResumeTime: statedSoon,
    });
    const { judgment } = await judge(buildRequest([personCollision, stated]));
    expect(judgment.resumeQueue).toBeUndefined();
    expect(judgment.action).toBe("wait");
  });

  it("駅間の車内では車内で待つと言い切り、次の駅で降りて乗り換える手を理由に添える", async () => {
    const position: TrainPosition = {
      kind: "between_stations",
      nextStation: "塚本",
      previousStation: "大阪",
      trainsAhead: [],
      trainsAheadCount: null,
      ownTrainType: "local",
      trainsAheadHeadwayMinutes: null,
    };
    const queue = buildObservation({
      id: "queue",
      minutesAgo: 1,
      kind: "station_broadcast",
      rawText: queueText,
      statedResumeTime: statedSoon,
    });
    const { judgment } = await judge(
      buildRequest([personCollision, queue], { trainPosition: position, origin: "塚本" }),
    );
    expect(judgment.action).toBe("wait");
    expect(judgment.inCar).toBeDefined();
    expect(judgment.resumeQueue?.worthAlightingAtNextStation).toBe(true);
    expect(judgment.reason).toContain("塚本で降りて乗り換える手があります。");
  });

  it("列車を詰めない事業者では、自分の番までの分を出さず、降りる価値も示さない", async () => {
    const queue = buildObservation({
      id: "queue",
      minutesAgo: 1,
      kind: "station_broadcast",
      rawText: queueText,
      operator: "阪急電鉄",
      line: "阪急神戸線",
    });
    const cause = { ...personCollision, operator: "阪急電鉄", line: "阪急神戸線" };
    const { judgment } = await judge(
      buildRequest([cause, queue], { origin: "大阪梅田", destination: "神戸三宮" }),
    );
    expect(judgment.resumeQueue).toMatchObject({
      closesUp: false,
      waitRange: null,
      worthAlightingAtNextStation: false,
    });
  });
});

describe("選択式の入力", () => {
  const ctx = {
    lines: deps.provider.listLines(),
    contextEventType: null,
    observationId: "sel_1",
    observedAt: now,
  };

  it("種類の id と手がかりの id を受け、表に無い手がかりは捨てる", () => {
    const observation = interpretSelection(
      {
        type: "selection",
        eventType: "person_collision",
        signalIds: ["protection_received", "pa_occurred_announced"],
      },
      ctx,
    );
    expect(observation.eventTypeCandidates).toEqual([
      { eventType: "person_collision", confidence: "high" },
    ]);
    expect(observation.detectedSignals.map((s) => s.signalId)).toEqual(["protection_received"]);
  });

  it("以前の知見の事象の id は、統計値の種類の id に直す", () => {
    const observation = interpretSelection(
      { type: "selection", eventType: "person_accident", signalIds: [] },
      ctx,
    );
    expect(observation.eventTypeCandidates[0]?.eventType).toBe("person_collision");
  });

  it("種類が 1 つに決まらない原因は、統計値の大分類の id のまま候補に残す", () => {
    const observation = interpretSelection(
      { type: "selection", eventType: "vehicle", signalIds: [] },
      ctx,
    );
    expect(observation.eventTypeCandidates).toEqual([{ eventType: "vehicle", confidence: "high" }]);
  });

  it("表に無い id は候補にしない", () => {
    const observation = interpretSelection(
      { type: "selection", eventType: "unknown_cause", signalIds: [] },
      ctx,
    );
    expect(observation.eventTypeCandidates).toEqual([]);
  });
});

describe("天気の大分類と台風", () => {
  // 雨が強まり続けている架空の観測値
  const rainyDeps = createTestDeps({
    fetchRain: async () => ({
      stationName: "テスト観測所",
      readings: [
        { time: addMinutesToIso(now, -10), rainfall10minMm: 4, warnings: ["大雨警報"] },
        { time: now, rainfall10minMm: 8, warnings: ["大雨警報"] },
      ],
    }),
  });

  it("入口で天気の大分類だけを答えても、気象を確かめ、雨が続くあいだは保留する", async () => {
    const request: JudgeRequest = {
      ...buildRequest([buildObservation({ id: "entry", minutesAgo: 5 })]),
      cause: { group: "weather", type: null },
    };
    const events = await postJudge(createTestApp(rainyDeps), request);
    const ready = events.find((e) => e.type === "judgment_ready");
    if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
    expect(ready.judgment.estimate.eventType).toBeNull();
    expect(events.some((e) => e.type === "weather_checked")).toBe(true);
    expect(ready.judgment.action).toBe("hold");
    expect(ready.judgment.headline).toBe("雨が弱まるまで待つ");
  });

  it("選択式で天気の大分類の id を送っても、同じく気象を確かめる", async () => {
    const request: JudgeRequest = {
      ...buildRequest([]),
      newInput: { type: "selection", eventType: "weather", signalIds: [] },
    };
    const events = await postJudge(createTestApp(rainyDeps), request);
    expect(events.some((e) => e.type === "weather_checked")).toBe(true);
  });

  it("発表に台風の語があれば、強風の長さの見込みを very_long に上げる", () => {
    const wind = buildObservation({ id: "wind", minutesAgo: 5, eventType: "strong_wind" });
    const typhoon = { ...wind, rawText: "台風の接近に伴う強風のため、運転を見合わせています。" };
    const estimateFor = (observations: Observation[]) => {
      const request = buildRequest(observations);
      const ctx: ToolContext = {
        request,
        observations,
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      };
      return runEstimateRemaining(ctx, { eventType: "strong_wind" });
    };
    expect(estimateFor([wind]).flowOutlook).toBe("long");
    expect(estimateFor([typhoon]).flowOutlook).toBe("very_long");
  });
});

describe("本数と駅の数の検査", () => {
  it("列車の本数と駅の数は、ツールの結果と原文にある値だけを許す", async () => {
    const session = createJudgeSession(
      {
        request: buildRequest([personCollision, queueObservation]),
        observations: [personCollision, queueObservation],
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      },
      createEventSink(
        async () => {},
        () => now,
      ),
    );
    await session.executeTool("estimate_remaining", { eventType: "person_collision" });
    await session.executeTool("find_alternatives", {});
    await session.executeTool("compute_break_even", {});
    const { estimate, alternatives, breakEven } = session.state;
    if (!estimate || !alternatives || !breakEven) throw new Error("ツールの結果がそろいません");
    const results = { estimate, alternatives, breakEven };
    const queued = estimate.resumeQueue?.trainsInQueue;
    if (!queued) throw new Error("詰まりの本数がありません");
    const decide = (reason: string) =>
      assembleJudgment(
        results,
        {
          action: "hold",
          headline: "このまま待つ",
          reason,
          breakEvenExplanation: "説明",
          recommendedOptionId: null,
          evidence: [],
        },
        "ja",
      );
    expect(
      session.checkJudgment(decide(`前に${queued}本詰まっています。`), results).errors,
    ).toEqual([]);
    const errors = session.checkJudgment(
      decide(`前に${queued + 7}本詰まっています。発生場所まで${queued + 9}駅です。`),
      results,
    ).errors;
    expect(errors.some((e) => e.includes(`${queued + 7}本`))).toBe(true);
    expect(errors.some((e) => e.includes(`${queued + 9}駅`))).toBe(true);
  });

  it("英語の本数と駅の数も拾う", () => {
    const n = extractTextNumbers("2 trains ahead, 3 stations away, and 1 stop.");
    expect(n.counts.map((c) => c.value)).toEqual([2, 3, 1]);
    expect(n.minutes).toEqual([]);
  });
});

describe("止まった理由の見込み", () => {
  const position: TrainPosition = {
    kind: "between_stations",
    nextStation: "塚本",
    previousStation: "大阪",
    trainsAhead: [],
    trainsAheadCount: null,
    ownTrainType: "local",
    trainsAheadHeadwayMinutes: null,
  };
  const personLongAgo = buildObservation({
    id: "entry-cause",
    minutesAgo: 20,
    eventType: "person_collision",
  });

  it("電車の中の人身事故では、割合といちばん可能性の高い理由を判断と phase_estimated に載せる", async () => {
    const { judgment, events } = await judge(
      buildRequest([personLongAgo], { trainPosition: position, origin: "塚本" }),
    );
    const reasons = judgment.stopReasons;
    expect(reasons?.trainCounts.own_incident).toBe(1);
    expect(reasons?.trainCounts.dispatcher_order).toBeGreaterThan(0);
    expect(reasons?.mostLikely).toBe("dispatcher_order");
    expect(reasons?.shares.own_incident).toBeLessThan(0.2);
    const estimated = events.find((e) => e.type === "phase_estimated");
    expect(estimated).toMatchObject({ stopReasons: reasons });
  });

  it("入口で受信の放送が無かったと答えたら、人身事故でも受信の本数を 0 にし、防護無線の事象のままにする", async () => {
    const { judgment, events } = await judge(
      buildRequest([personLongAgo], {
        trainPosition: position,
        origin: "塚本",
        protectionBroadcast: "not_heard",
      }),
    );
    const reasons = judgment.stopReasons;
    expect(reasons?.trainCounts.protection_received).toBe(0);
    expect(reasons?.shares.protection_received).toBe(0);
    expect(reasons?.mostLikely).toBe("dispatcher_order");
    expect(judgment.protection).toBe(true);
    expect(judgment.unaffectedTrack).toBeDefined();
    const estimated = events.find((e) => e.type === "phase_estimated");
    expect(estimated).toMatchObject({ stopReasons: reasons });
  });

  it("claude モードのツールの結果にも、受信の放送が無かった答えを効かせる", async () => {
    const request = buildRequest([personLongAgo], {
      trainPosition: position,
      origin: "塚本",
      protectionBroadcast: "not_heard",
    });
    const session = createJudgeSession(
      {
        request,
        observations: [personLongAgo],
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      },
      createEventSink(
        async () => {},
        () => now,
      ),
    );
    const outcome = await session.executeTool("estimate_remaining", {
      eventType: "person_collision",
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toMatchObject({
      protection: true,
      stopReasons: { trainCounts: { protection_received: 0 }, mostLikely: "dispatcher_order" },
    });
  });

  it("入口で受信の放送が聞こえたと答えたら、観測が無くても防護無線に確定する", async () => {
    const { judgment } = await judge(
      buildRequest([], { trainPosition: position, origin: "塚本", protectionBroadcast: "heard" }),
    );
    expect(judgment.protection).toBe(true);
    expect(judgment.stopReasons?.mostLikely).toBe("protection_received");
  });

  it("電車の中で大雨なら、指令の指示がいちばん高く、当該は 0", async () => {
    const rain = buildObservation({ id: "entry-cause", minutesAgo: 10, eventType: "heavy_rain" });
    const { judgment } = await judge(
      buildRequest([rain], { trainPosition: position, origin: "塚本" }),
    );
    expect(judgment.stopReasons?.mostLikely).toBe("dispatcher_order");
    expect(judgment.stopReasons?.shares.own_incident).toBe(0);
  });

  it("受信の放送が聞こえれば、防護無線に確定する", async () => {
    const { judgment } = await judge(
      buildRequest([protectionHeard], { trainPosition: position, origin: "塚本" }),
    );
    expect(judgment.stopReasons?.mostLikely).toBe("protection_received");
    expect(judgment.stopReasons?.shares.protection_received).toBe(1);
  });

  it("電車の中の急病人で長く止まっていれば、詰まりがいちばん高い", async () => {
    const medical = buildObservation({
      id: "entry-cause",
      minutesAgo: 40,
      eventType: "medical_response",
    });
    const { judgment } = await judge(
      buildRequest([medical], { trainPosition: position, origin: "塚本" }),
    );
    expect(judgment.stopReasons?.mostLikely).toBe("queued_behind");
  });

  it("駅で待つ人には載せない", async () => {
    const { judgment } = await judge(buildRequest([personLongAgo]));
    expect(judgment.stopReasons).toBeUndefined();
  });

  it("止まった理由は言葉の強さだけで書かせ、理由の文の割合は理由の値でも確率の値でも検証エラーにする", async () => {
    const request = buildRequest([personLongAgo], { trainPosition: position, origin: "塚本" });
    const session = createJudgeSession(
      {
        request,
        observations: [personLongAgo],
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      },
      createEventSink(
        async () => {},
        () => now,
      ),
    );
    await session.executeTool("estimate_remaining", { eventType: "person_collision" });
    await session.executeTool("find_alternatives", {});
    await session.executeTool("compute_break_even", {});
    const { estimate, alternatives, breakEven } = session.state;
    if (!estimate?.stopReasons || !alternatives || !breakEven?.resumeChance)
      throw new Error("ツールの結果がそろいません");
    const results = { estimate, alternatives, breakEven };
    const decide = (reason: string) =>
      assembleJudgment(
        results,
        {
          action: "wait",
          headline: "車内で待つ",
          reason,
          breakEvenExplanation: "説明",
          recommendedOptionId: null,
          evidence: [],
        },
        "ja",
      );
    const shareErrors = (reason: string) =>
      session.checkJudgment(decide(reason), results).errors.filter((e) => e.includes("割合"));
    // 確率の目盛りにある割合。理由の文に流用させない
    const tick = breakEven.resumeChance.ticks.find((t) => t.tenths >= 1 && t.tenths <= 9);
    if (!tick) throw new Error("目盛りの割合がありません");
    const ownTenths = Math.round(estimate.stopReasons.shares.dispatcher_order * 10);

    expect(shareErrors("区間ごと止められている可能性が高いです。")).toEqual([]);
    expect(shareErrors(`区間ごと止められている見込みが${ownTenths}割です。`)).toHaveLength(1);
    expect(shareErrors(`指令の指示で止まった見込みが${tick.tenths}割です。`)).toHaveLength(1);
    expect(shareErrors("この列車で何か起きた見込みは30%です。")).toHaveLength(1);
  });

  it("受信が聞こえて防護無線が 10 割でも、「9割」と書けば検証エラーになる", async () => {
    const request = buildRequest([protectionHeard], { trainPosition: position, origin: "塚本" });
    const session = createJudgeSession(
      {
        request,
        observations: [protectionHeard],
        content: deps.content,
        provider: deps.provider,
        scenario: null,
        fetchRain: deps.fetchRain,
      },
      createEventSink(
        async () => {},
        () => now,
      ),
    );
    await session.executeTool("estimate_remaining", { eventType: null });
    await session.executeTool("find_alternatives", {});
    await session.executeTool("compute_break_even", {});
    const { estimate, alternatives, breakEven } = session.state;
    if (!estimate?.stopReasons || !alternatives || !breakEven)
      throw new Error("ツールの結果がそろいません");
    expect(estimate.stopReasons.shares.protection_received).toBe(1);
    const judgment = assembleJudgment(
      { estimate, alternatives, breakEven },
      {
        action: "wait",
        headline: "車内で待つ",
        reason: "近くの非常停止を受けて止まった見込みが9割です。",
        breakEvenExplanation: "説明",
        recommendedOptionId: null,
        evidence: [],
      },
      "ja",
    );
    const errors = session.checkJudgment(judgment, { estimate, alternatives, breakEven }).errors;
    expect(errors.some((e) => e.includes("9割"))).toBe(true);
  });

  it("理由の語の無い文の割合は、止まった理由の検査にかけない", () => {
    expect(checkStopReasonShares("reason", "21時30分までに動く見込みは3割です。")).toEqual([]);
    expect(
      checkStopReasonShares(
        "reason",
        "区間ごと止められている可能性が高いです。動く見込みは3割です。",
      ),
    ).toEqual([]);
  });
});
