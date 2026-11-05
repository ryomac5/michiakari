import { describe, expect, it } from "vitest";
import { MAX_INPUT_TEXT_LENGTH, ObservationSchema, RawInputSchema } from "../src/index.ts";
import { validObservation } from "./fixtures/api.ts";

describe("RawInputSchema", () => {
  it.each([
    { type: "photo", imageBase64: "aGVsbG8=", mediaType: "image/jpeg" },
    { type: "text", text: "架空の発表文" },
    { type: "selection", eventType: "sample_event", signalIds: ["checking_announced"] },
    {
      type: "scenario",
      scenarioId: "sample_scenario",
      observationId: "obs_1",
      kind: "announcement",
      text: { ja: "架空" },
    },
  ])("$type を受け入れる", (input) => {
    expect(RawInputSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { type: "photo", imageBase64: "aGVsbG8=", mediaType: "application/pdf" },
    { type: "text", text: "" },
    { type: "selection", eventType: "Sample", signalIds: [] },
    {
      type: "scenario",
      scenarioId: "sample_scenario",
      observationId: "obs_1",
      kind: "rumor",
      text: { ja: "架空" },
    },
    { type: "scenario", observationId: "obs_1", kind: "announcement", text: { ja: "架空" } },
    { type: "voice", text: "未知の種類" },
  ])("不正な $type を拒否する", (input) => {
    expect(RawInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("ObservationSchema", () => {
  it("合格例を受け入れる", () => {
    expect(ObservationSchema.safeParse(validObservation).success).toBe(true);
  });

  it("kind と rawText を省略し、記載のない項目を null にできる", () => {
    const { kind: _k, rawText: _r, ...rest } = validObservation;
    const value = {
      ...rest,
      source: "photo",
      operator: null,
      line: null,
      section: null,
      transferServiceActive: null,
    };
    expect(ObservationSchema.safeParse(value).success).toBe(true);
  });

  it("statedResumeTime にオフセットのない時刻を拒否する", () => {
    const value = { ...validObservation, statedResumeTime: "2026-11-05T23:30:00" };
    expect(ObservationSchema.safeParse(value).success).toBe(false);
  });

  it("未知の source と確信度を拒否する", () => {
    expect(ObservationSchema.safeParse({ ...validObservation, source: "sns" }).success).toBe(false);
    const value = {
      ...validObservation,
      eventTypeCandidates: [{ eventType: "sample_event", confidence: 0.9 }],
    };
    expect(ObservationSchema.safeParse(value).success).toBe(false);
  });

  it("必須項目の欠落を拒否する", () => {
    const { detectedSignals: _d, ...rest } = validObservation;
    expect(ObservationSchema.safeParse(rest).success).toBe(false);
  });
});

describe("文章の上限", () => {
  const atLimit = "あ".repeat(MAX_INPUT_TEXT_LENGTH);
  const overLimit = "あ".repeat(MAX_INPUT_TEXT_LENGTH + 1);

  it("貼り付けた文章とシナリオの文章は上限まで受け入れ、超えたら拒否する", () => {
    expect(RawInputSchema.safeParse({ type: "text", text: atLimit }).success).toBe(true);
    expect(RawInputSchema.safeParse({ type: "text", text: overLimit }).success).toBe(false);
    const scenario = {
      type: "scenario",
      scenarioId: "s",
      observationId: "o",
      kind: "announcement",
    };
    expect(RawInputSchema.safeParse({ ...scenario, text: { ja: atLimit, en: "x" } }).success).toBe(
      true,
    );
    expect(RawInputSchema.safeParse({ ...scenario, text: { ja: overLimit } }).success).toBe(false);
    expect(
      RawInputSchema.safeParse({ ...scenario, text: { ja: "x", en: overLimit } }).success,
    ).toBe(false);
  });

  it("観測の原文は上限を超えたら拒否する", () => {
    expect(ObservationSchema.safeParse({ ...validObservation, rawText: atLimit }).success).toBe(
      true,
    );
    expect(ObservationSchema.safeParse({ ...validObservation, rawText: overLimit }).success).toBe(
      false,
    );
  });
});

describe("走行位置画像の種別", () => {
  it.each([
    { trainsAhead: [] },
    { trainsAhead: ["local", "rapid", "special_rapid", "limited_express", "unknown"] },
  ])("前の列車の並び $trainsAhead を保持する", ({ trainsAhead }) => {
    expect(ObservationSchema.parse({ ...validObservation, trainsAhead }).trainsAhead).toEqual(
      trainsAhead,
    );
  });

  it("列挙外の種別を拒否する", () => {
    expect(
      ObservationSchema.safeParse({ ...validObservation, trainsAhead: ["express"] }).success,
    ).toBe(false);
  });
});
