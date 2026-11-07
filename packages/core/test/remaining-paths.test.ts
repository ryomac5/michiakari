import { describe, expect, it } from "vitest";
import { STATED_RESUME_SLACK_MINUTES } from "../params/estimation.ts";
import { estimateStatedRemainingWithoutKnowledge } from "../src/index.ts";

// 発表された再開見込みの時刻からの残り時間

describe("estimateStatedRemainingWithoutKnowledge", () => {
  it("p50 は発表の時刻どおりで、p80 は延びる余地の分だけ後ろにする", () => {
    expect(
      estimateStatedRemainingWithoutKnowledge(
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T22:32:00+09:00",
      ),
    ).toEqual({ p50: 18, p80: 18 + STATED_RESUME_SLACK_MINUTES });
  });

  it("端数は切り上げ、過ぎた見込み時刻は 0 分として扱う", () => {
    expect(
      estimateStatedRemainingWithoutKnowledge(
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T22:49:30+09:00",
      ),
    ).toEqual({ p50: 1, p80: 1 + STATED_RESUME_SLACK_MINUTES });
    expect(
      estimateStatedRemainingWithoutKnowledge(
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T23:00:00+09:00",
      ),
    ).toEqual({ p50: 0, p80: STATED_RESUME_SLACK_MINUTES });
  });
});
