import type { Judgment, RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { selectFallbackOptionId } from "./fallback-option";

const option = (id: string, kind: RouteOption["kind"], arrival: string): RouteOption => ({
  id,
  kind,
  label: id,
  legs: [],
  arrivalTime: `2026-11-06T${arrival}:00+09:00`,
  fareYen: null,
  walkMinutes: 0,
  isTransferService: false,
});

const options = [
  option("wait_resume", "wait", "00:10"),
  option("transfer_keihan", "transfer", "00:30"),
  option("transfer_hankyu", "transfer", "00:20"),
  option("taxi", "taxi", "00:05"),
];

function buildJudgment(overrides: Partial<Judgment>): Judgment {
  return {
    action: "wait",
    headline: "22時46分まで待つ。動かなければ阪急京都線へ",
    breakEven: { time: "2026-11-05T22:46:00+09:00", explanation: "" },
    estimate: {
      eventType: "person_accident",
      phaseId: null,
      elapsedMinutes: 0,
      remaining: null,
      confidence: "medium",
    },
    options,
    recommendedOptionId: "wait_resume",
    evidence: [],
    disclaimer: "推定です。",
    ...overrides,
  };
}

describe("selectFallbackOptionId", () => {
  it("待つ判断では、鉄道の代替のうち到着がいちばん早いものを指す", () => {
    expect(selectFallbackOptionId(buildJudgment({}))).toBe("transfer_hankyu");
  });

  it("鉄道の代替が無ければタクシーを指す", () => {
    const judgment = buildJudgment({ options: [options[0], options[3]] as RouteOption[] });
    expect(selectFallbackOptionId(judgment)).toBe("taxi");
  });

  it("鉄道が期限に間に合わずタクシーなら間に合うときは、タクシーを指す", () => {
    expect(selectFallbackOptionId(buildJudgment({}), "2026-11-06T00:10:00+09:00")).toBe("taxi");
  });

  it("切り替え、境目の無い判断、駅間の車内、判断が無いときは指さない", () => {
    expect(
      selectFallbackOptionId(
        buildJudgment({ action: "switch", recommendedOptionId: "transfer_hankyu" }),
      ),
    ).toBeNull();
    expect(selectFallbackOptionId(buildJudgment({ breakEven: null }))).toBeNull();
    expect(
      selectFallbackOptionId(
        buildJudgment({
          inCar: {} as NonNullable<Judgment["inCar"]>,
        }),
      ),
    ).toBeNull();
    expect(selectFallbackOptionId(null)).toBeNull();
  });

  it("代わりの手段が無ければ指さない", () => {
    expect(
      selectFallbackOptionId(buildJudgment({ options: [options[0]] as RouteOption[] })),
    ).toBeNull();
  });
});
