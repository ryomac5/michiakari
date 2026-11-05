import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { models } from "../src/config.ts";
import {
  convertInterpretation,
  InterpretationSchema,
  interpretWithClaude,
} from "../src/interpret/claude-interpret.ts";
import { interpretRawInputDeterministically } from "../src/interpret/deterministic-interpret.ts";
import { createTestDeps } from "./helpers.ts";

const deps = createTestDeps();
const ctx = {
  knowledge: deps.content.knowledge,
  lines: deps.provider.listLines(),
  contextEventType: null,
  observationId: "photo_1",
  observedAt: "2026-11-05T22:00:00+09:00",
};
const interpretation = {
  kind: "train_movement",
  rawText: "快速 普通",
  eventTypeCandidates: [],
  operator: null,
  line: null,
  section: null,
  statedResumeClock: null,
  transferServiceActive: null,
  detectedSignals: [],
};

function buildPhoto(fileName: string) {
  return {
    type: "photo" as const,
    imageBase64: "aGVsbG8=",
    mediaType: "image/png" as const,
    fileName,
  };
}

describe("走行位置の読み取り", () => {
  it.each([
    { trainsAhead: undefined },
    { trainsAhead: [] },
    { trainsAhead: ["rapid", "local", "unknown"] },
  ])("任意の並び $trainsAhead を検証して観測へ渡す", ({ trainsAhead }) => {
    const parsed = InterpretationSchema.parse({ ...interpretation, trainsAhead });
    const observation = convertInterpretation(parsed, buildPhoto("screen.png"), ctx);
    expect(observation.trainsAhead).toEqual(trainsAhead);
  });

  it("列挙外の種別を拒否する", () => {
    expect(
      InterpretationSchema.safeParse({ ...interpretation, trainsAhead: ["express"] }).success,
    ).toBe(false);
  });

  it("走行位置以外の解釈から並びを取り込まない", () => {
    const parsed = InterpretationSchema.parse({
      ...interpretation,
      kind: "announcement",
      trainsAhead: ["rapid"],
    });
    expect(
      convertInterpretation(parsed, buildPhoto("screen.png"), ctx).trainsAhead,
    ).toBeUndefined();
  });

  it.each([
    ["rapid+local", ["rapid", "local"]],
    ["special_rapid+limited_express+unknown", ["special_rapid", "limited_express", "unknown"]],
    ["none", []],
  ])("決定論モードの画像 fixture %s を同じ観測にする", (name, expected) => {
    const observation = interpretRawInputDeterministically(
      buildPhoto(`fixture-train-movement--${name}.png`),
      ctx,
    );
    expect(observation?.kind).toBe("train_movement");
    expect(observation?.trainsAhead).toEqual(expected);
  });

  it.each(["screen.png", "rapid.png", "fixture-train-movement--express.png"])(
    "通常の画像や不正な fixture %s の内容を推測しない",
    (fileName) => {
      expect(interpretRawInputDeterministically(buildPhoto(fileName), ctx)).toBeNull();
    },
  );
});

it("Claude の画像出力をスキーマで検証し、設定のモデルと外部プロンプトを使う", async () => {
  const input = buildPhoto("ordinary-screen.png");
  const observation = await interpretWithClaude(input, {
    ...ctx,
    prompts: deps.prompts,
    llm: {
      async createMessage(params) {
        expect(params.model).toBe(models.interpretation);
        expect(params.system).toEqual(
          expect.arrayContaining([{ type: "text", text: deps.prompts.interpretationSystem }]),
        );
        expect(params.messages[0]?.content).toEqual(
          expect.arrayContaining([
            {
              type: "image",
              source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 },
            },
          ]),
        );
        return {
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...interpretation, trainsAhead: ["rapid", "unknown"] }),
            },
          ],
        } as BetaMessage;
      },
    },
  });
  expect(observation.source).toBe("photo");
  expect(observation.trainsAhead).toEqual(["rapid", "unknown"]);
});
