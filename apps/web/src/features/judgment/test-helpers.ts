import type { JudgeRequest } from "@repo/schema";
import { buildJudgeRequest } from "./request";

// 単体テスト用の要求。時刻は日本時間で固定する
export function buildTestRequest(overrides: Partial<JudgeRequest> = {}): JudgeRequest {
  return {
    ...buildJudgeRequest({
      observations: [],
      newInput: { type: "text", text: "人身事故のため運転を見合わせています" },
      origin: { kind: "station", name: "大阪" },
      destination: { kind: "station", name: "三ノ宮" },
      language: "ja",
      now: new Date("2026-11-05T22:40:00+09:00"),
    }),
    now: "2026-11-05T22:40:00+09:00",
    ...overrides,
  };
}
