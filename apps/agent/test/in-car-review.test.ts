import { addMinutesToIso, decideAfterAlightStep, diffMinutes } from "@repo/core";
import type { JudgeRequest, Judgment, JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createGeoProvider } from "../src/alternatives/geo-provider.ts";
import type { AlternativesQuery } from "../src/alternatives/provider.ts";
import { type AllowedNumbers, validateJudgment } from "../src/judge/assemble.ts";
import { createTestApp, postJudge } from "./helpers.ts";

// 駅間の車内の判断のレビューで見つかった食い違いを固定する

const provider = createGeoProvider();
const app = createTestApp();
const now = "2026-11-05T22:00:00+09:00";

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

describe("駅間の車内の待つ側の到着", () => {
  const base: AlternativesQuery = {
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "西宮北口" },
    blockedLine: "JR神戸線",
    blockedSection: { fromStation: "大阪", toStation: "西宮北口" },
    blockedSectionFromTrain: true,
    now,
    remaining: { p50: 0, p80: 10 },
    transferServiceActive: null,
    language: "ja",
  };

  it("待つ側も、降りる駅に着く見込みの時刻を起点にする", async () => {
    const departureTime = addMinutesToIso(now, 30);
    const result = await provider.findAlternatives({ ...base, departureTime });
    const wait = result.options.find((o) => o.kind === "wait");
    const route = result.waitRouteMinutesAfterResume ?? 0;
    expect(route).toBeGreaterThan(0);
    // 再開の見込みより降りる駅に着くほうが遅いので、着く時刻から乗り続ける
    expect(diffMinutes(departureTime, wait?.arrivalTime ?? now)).toBe(route);
  });
});

describe("車内で待つ側の到着と初列車待ち", () => {
  const inCar: AlternativesQuery = {
    origin: { kind: "station", name: "塚本" },
    destination: { kind: "station", name: "西宮北口" },
    blockedLine: "JR神戸線",
    blockedSection: { fromStation: "大阪", toStation: "西宮北口" },
    blockedSectionFromTrain: true,
    now,
    // 乗れるまでの残り 40 分のうち、10 分は駅で最初の列車を待つ分
    remaining: { p50: 40, p80: 60 },
    firstTrainWaitMinutes: 10,
    departureTime: addMinutesToIso(now, 5),
    transferServiceActive: null,
    language: "ja",
  };

  it("車内の人はすでに乗っているので、初列車待ちを除いた再開の見込みから乗り続ける", async () => {
    const result = await provider.findAlternatives(inCar);
    const wait = result.options.find((o) => o.kind === "wait");
    const route = result.waitRouteMinutesAfterResume ?? 0;
    expect(route).toBeGreaterThan(0);
    expect(diffMinutes(now, wait?.arrivalTime ?? now)).toBe(30 + route);
  });

  it("初列車待ちを重ねると、待つより遅い手段を着いた後の一手に勧めてしまう", async () => {
    const result = await provider.findAlternatives(inCar);
    const wait = result.options.find((o) => o.kind === "wait");
    if (!wait) throw new Error("待つ選択肢がありません");
    const route = result.waitRouteMinutesAfterResume ?? 0;
    // 初列車待ちを除いた待つ到着の 5 分後に着く手段。初列車待ちを重ねた待つ到着よりは早い
    const later = {
      id: "transfer_late",
      kind: "transfer" as const,
      label: "遅い手段",
      legs: [{ mode: "walk" as const, from: "塚本", to: "西宮北口", minutes: 60 }],
      arrivalTime: addMinutesToIso(now, 30 + route + 5),
      fareYen: null,
      walkMinutes: 60,
      isTransferService: false,
    };
    const decided = decideAfterAlightStep({
      alightStation: "塚本",
      departureStation: "塚本",
      destinationStation: "西宮北口",
      waitOption: wait,
      options: [wait, later],
    });
    expect(decided).toEqual({ step: null, reason: "wait_faster" });
  });
});

describe("根拠の説明の検査を除く条件", () => {
  const allowed: AllowedNumbers = {
    clockMinutes: new Set(),
    hours: new Set(),
    minutes: new Set(),
    yen: new Set(),
    shares: new Set(),
    counts: new Set(),
  };
  const quote = "発表の「運転を見合わせています。振替輸送を行っています」";
  const evidenceRefs = [
    { kind: "signal" as const, id: "sig_quote", description: quote },
    {
      kind: "cue" as const,
      id: "resume_soon",
      description: "再開が近いとみられます。",
    },
  ];
  const judgmentWith = (evidence: { kind: string; id: string; description: string }[]) => ({
    action: "wait",
    headline: "車内で待つ",
    reason: "車内では列車が動くのを待ちます。",
    breakEven: null,
    estimate: {
      eventType: "medical_response",
      phaseId: null,
      elapsedMinutes: null,
      remaining: null,
      confidence: "low",
    },
    options: [],
    recommendedOptionId: null,
    evidence,
    disclaimer: "推定です。公式発表を優先する。",
  });
  const check = (evidence: { kind: string; id: string; description: string }[]) =>
    validateJudgment({
      judgment: judgmentWith(evidence),
      language: "ja",
      evidenceRefs,
      allowedNumbers: allowed,
      inCarAlternativeLines: [],
      stopScope: "train",
    }).errors;

  it("その ID の根拠の説明と一字一句同じ文だけを検査から除く", () => {
    expect(check([{ kind: "signal", id: "sig_quote", description: quote }])).toEqual([]);
  });

  it("別の根拠の ID に引用の文を付けても、検査から除かない", () => {
    const errors = check([{ kind: "cue", id: "resume_soon", description: quote }]);
    expect(errors.some((e) => e.includes("evidence[0].description の「見合わせ」"))).toBe(true);
    expect(errors.some((e) => e.includes("evidence[0].description の「振替」"))).toBe(true);
  });
});

describe("止まった区間の延長", () => {
  it("駅にいる人の区間は、終わりが別の路線の駅でも延ばさない。区間が無いときと同じ代替手段になる", async () => {
    const atStation: AlternativesQuery = {
      origin: { kind: "station", name: "塚本" },
      destination: { kind: "station", name: "西宮北口" },
      blockedLine: "JR神戸線",
      blockedSection: { fromStation: "大阪", toStation: "西宮北口" },
      now,
      remaining: { p50: 60, p80: 90 },
      transferServiceActive: null,
      language: "ja",
    };
    const withSection = await provider.findAlternatives(atStation);
    const withoutSection = await provider.findAlternatives({ ...atStation, blockedSection: null });
    expect(withSection.options).toEqual(withoutSection.options);
  });
});

describe("次の駅が分からない駅間の車内", () => {
  it("次の駅が分からなくても、車内で待つ形にし、選択肢を出さない", async () => {
    const request: JudgeRequest = {
      observations: [
        {
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
        },
      ],
      newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
      origin: { kind: "station", name: "塚本" },
      destination: { kind: "station", name: "三ノ宮" },
      constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
      language: "ja",
      now,
      trainPosition: {
        kind: "between_stations",
        nextStation: null,
        previousStation: null,
        trainsAhead: null,
        trainsAheadCount: null,
        ownTrainType: null,
      },
    };
    const judgment = findJudgment(await postJudge(app, request));
    expect(judgment.action).toBe("wait");
    expect(judgment.options).toEqual([]);
    expect(judgment.breakEven).toBeNull();
    expect(judgment.headline).toBe("車内で待つ");
    expect(judgment.inCar?.alightStation).toBeNull();
    expect(judgment.inCar?.afterAlight).toBeNull();
    expect(JSON.stringify(judgment.inCar)).not.toContain("係員");
  });
});

describe("発表に区間が無い駅間の車内", () => {
  it("決定論モードの判断の文に、駅の間の位置から作った区間を書かない", async () => {
    const request: JudgeRequest = {
      observations: [
        {
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
        },
      ],
      newInput: { type: "selection", eventType: "person_accident", signalIds: [] },
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
    };
    const judgment = findJudgment(await postJudge(app, request));
    const texts = [
      judgment.headline,
      judgment.reason ?? "",
      judgment.breakEven?.explanation ?? "",
      ...judgment.evidence.map((e) => e.description),
    ].join("\n");
    // 代わりの手段から外す範囲の仮定「大阪〜三ノ宮」は、判断の文に出さない
    expect(texts).not.toContain("大阪〜三ノ宮");
    expect(texts).not.toMatch(/大阪[〜～–]三ノ宮/);
  });
});
