import type { ResumeQueue, RouteOption, UnaffectedTrack } from "@repo/schema";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import {
  buildMinuteRange,
  checkProtectionReading,
  formatQueueWait,
  formatTrackLine,
  type RuleTranslate,
  selectAlightOptionId,
  selectQueueLines,
  selectTrackLines,
} from "./rule-outlook";

function createRuleTranslate(locale: "ja" | "en"): RuleTranslate {
  const t = createTranslator({
    locale,
    messages: locale === "ja" ? ja : en,
    namespace: "judgment.rules",
  });
  return (key, values) => t(key as never, values as never);
}

const tJa = createRuleTranslate("ja");

function buildOption(id: string, kind: RouteOption["kind"], arrivalMinute: number): RouteOption {
  return {
    id,
    kind,
    label: id,
    legs: [],
    arrivalTime: `2026-11-07T22:${String(arrivalMinute).padStart(2, "0")}:00+09:00`,
    fareYen: null,
    walkMinutes: 0,
    isTransferService: false,
  };
}

const track = (trackSide: UnaffectedTrack["trackSide"]): UnaffectedTrack => ({
  trackSide,
  affected: trackSide === "opposite" ? null : { p50: 60, p80: 90 },
  opposite: trackSide === "affected" ? null : { p50: 10, p80: 15 },
});

const queue = (overrides: Partial<ResumeQueue> = {}): ResumeQueue => ({
  closesUp: true,
  trainsInQueue: 2,
  waitRange: { minMinutes: 6, maxMinutes: 10 },
  queueAnnounced: false,
  worthAlightingAtNextStation: false,
  ...overrides,
});

describe("checkProtectionReading", () => {
  it("防護無線の事象のときだけ 1 行の読みを出す", () => {
    expect(checkProtectionReading({ protection: true })).toBe(true);
    expect(checkProtectionReading({ protection: false })).toBe(false);
    expect(checkProtectionReading({})).toBe(false);
  });

  it("読みは短い 1 文で、括弧も段階の言い方も無い", () => {
    expect(tJa("protection")).toBe("近くで非常停止があったと読めます");
    expect(createRuleTranslate("en")("protection")).toBe(
      "An emergency stop likely happened nearby",
    );
  });
});

describe("buildMinuteRange", () => {
  it("幅は「10〜15分ほど」、同じか下が 0 なら 1 つの数、上も 0 ならまもなく", () => {
    expect(buildMinuteRange(10, 15)).toEqual({ kind: "range", min: 10, max: 15 });
    expect(buildMinuteRange(5, 5)).toEqual({ kind: "single", minutes: 5 });
    expect(buildMinuteRange(0, 5)).toEqual({ kind: "single", minutes: 5 });
    expect(buildMinuteRange(0, 0)).toEqual({ kind: "soon" });
  });
});

describe("selectTrackLines", () => {
  it("利用者の側が分からなければ、反対の線路と当該の線路の 2 行を見出し付きで並べる", () => {
    const lines = selectTrackLines(track("unknown"));
    expect(lines).toEqual([
      { side: "opposite", range: { kind: "range", min: 10, max: 15 }, labeled: true },
      { side: "affected", labeled: true },
    ]);
    expect(lines.map((l) => formatTrackLine(tJa, l))).toEqual([
      "確かめが済めば10〜15分ほどで動き出すことがあります",
      "長く止まる見込みです",
    ]);
    expect(tJa("track.oppositeLabel")).toBe("反対の線路や並ぶ線");
    expect(tJa("track.affectedLabel")).toBe("当該の線路");
  });

  it("側が分かっていれば、その側の 1 行だけを見出し無しで出す", () => {
    expect(selectTrackLines(track("opposite"))).toEqual([
      { side: "opposite", range: { kind: "range", min: 10, max: 15 }, labeled: false },
    ]);
    expect(selectTrackLines(track("affected"))).toEqual([{ side: "affected", labeled: false }]);
  });

  it("確かめの目安を過ぎていれば、まもなくと言う", () => {
    const [line] = selectTrackLines({ ...track("opposite"), opposite: { p50: 0, p80: 0 } });
    if (!line) throw new Error("行がありません");
    expect(formatTrackLine(tJa, line)).toBe("確かめが済めばまもなく動き出すことがあります");
  });

  it("見込みが無ければ何も出さない", () => {
    expect(selectTrackLines(undefined)).toEqual([]);
  });
});

describe("selectQueueLines", () => {
  const options = [
    buildOption("wait_resume", "wait", 50),
    buildOption("transfer_hankyu", "transfer", 45),
    buildOption("taxi", "taxi", 30),
  ];

  it("詰まりの幅を「◯〜◯分ほど」で出す", () => {
    const lines = selectQueueLines(queue(), options);
    expect(lines).toEqual({
      wait: { kind: "range", min: 6, max: 10 },
      alight: false,
      alightOptionId: null,
    });
    if (!lines?.wait) throw new Error("詰まりの行がありません");
    expect(formatQueueWait(tJa, lines.wait)).toBe(
      "動き出しても、前の列車が詰まり、先へ進むまで6〜10分ほどかかる見込みです",
    );
  });

  it("降りる価値があれば、乗り換えの行と agent の並びで先頭の乗り換え先を出す", () => {
    const lines = selectQueueLines(queue({ worthAlightingAtNextStation: true }), options);
    expect(lines?.alight).toBe(true);
    // 到着の早いタクシーではなく、agent が先に並べた乗り換え先を使う
    expect(lines?.alightOptionId).toBe("transfer_hankyu");
    expect(tJa("queue.alight")).toBe("次の駅で降りて乗り換える選択肢もあります");
  });

  it("乗り換え先が無ければ、行にはつながない", () => {
    const lines = selectQueueLines(
      queue({ worthAlightingAtNextStation: true }),
      options.slice(0, 1),
    );
    expect(lines?.alightOptionId).toBeNull();
  });

  it("詰めない事業者や前に列車が無く、降りる価値も無ければ出さない", () => {
    expect(selectQueueLines(queue({ closesUp: false, waitRange: null }), options)).toBeNull();
    expect(
      selectQueueLines(
        queue({ trainsInQueue: 0, waitRange: { minMinutes: 0, maxMinutes: 0 } }),
        options,
      ),
    ).toBeNull();
    expect(selectQueueLines(undefined, options)).toBeNull();
  });

  it("詰めない事業者でも、降りる価値があれば乗り換えの行だけを出す", () => {
    expect(
      selectQueueLines(
        queue({ closesUp: false, waitRange: null, worthAlightingAtNextStation: true }),
        options,
      ),
    ).toEqual({ wait: null, alight: true, alightOptionId: "transfer_hankyu" });
  });
});

describe("selectAlightOptionId", () => {
  it("並べ替えず、待つ以外の先頭を選ぶ", () => {
    expect(
      selectAlightOptionId([
        buildOption("taxi", "taxi", 30),
        buildOption("transfer", "transfer", 20),
      ]),
    ).toBe("taxi");
    expect(selectAlightOptionId([])).toBeNull();
  });
});

describe("訳の文", () => {
  it("新しい見込みの文に括弧と段階の言い方を入れない", () => {
    const texts = JSON.stringify(ja.judgment.rules);
    expect(texts).not.toMatch(/[（(]/);
    expect(texts).not.toMatch(/段階/);
  });
});
