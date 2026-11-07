import { addMinutesToIso, INCIDENT_GROUP_IDS, INCIDENT_TYPE_IDS } from "@repo/core";
import type { JudgeRequest, Judgment, JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { createTestApp, postJudge } from "./helpers.ts";

// 決定論モードの行動と、分岐点までに動く確率の向きがそろうことを、原因の種類ごとに表で確かめる
// 待つ・保留は分岐点まで待つと言うので、動く確率が 5 割を切るなら待つ理由が文に要る
// 切り替えは、動く確率が 5 割を超えるなら切り替える理由が文に要る
// 経過の分を振り、分岐点が見込みの幅の中ほどに来る入力を含める。大阪から三ノ宮へ向かう夜の場面

const app = createTestApp();
// 2026-11-06 は金曜。19 時台は通勤時間帯
const now = "2026-11-06T19:25:00+09:00";
const elapsedMinutesList = [0, 10, 30, 60, 120, 240] as const;

// 待つ・保留なのに確率が低いときに、文で示す待つ理由
const waitReasonPhrases = ["大きな差はありません", "発表どおり", "雨"] as const;
// 切り替えなのに確率が高いときに、文で示す切り替える理由
const switchReasonPhrases = ["期限", "詰まって"] as const;

type Cause = { label: string; request: Pick<JudgeRequest, "newInput" | "cause"> };

const causes: Cause[] = [
  ...INCIDENT_GROUP_IDS.map((group) => ({
    label: `大分類 ${group}`,
    request: { newInput: null, cause: { group, type: null } },
  })),
  ...INCIDENT_TYPE_IDS.map((eventType) => ({
    label: `種類 ${eventType}`,
    request: { newInput: { type: "selection" as const, eventType, signalIds: [] } },
  })),
];

function buildRequest(cause: Cause, elapsedMinutes: number): JudgeRequest {
  return {
    observations: [
      {
        id: "entry-line",
        observedAt: addMinutesToIso(now, -elapsedMinutes),
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
    origin: { kind: "station", name: "大阪" },
    destination: { kind: "station", name: "三ノ宮" },
    constraints: { deadline: null, knowsAlternatives: true, mobilityNotes: null },
    language: "ja",
    now,
    newInput: cause.request.newInput,
    ...(cause.request.cause ? { cause: cause.request.cause } : {}),
  };
}

function findJudgment(events: JudgmentEvent[]): Judgment {
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("judgment_ready が届きません");
  return ready.judgment;
}

// 行動と確率の向きが逆なら、その理由の言い回しを返す。逆でなければ "aligned"、確率が無ければ "no_chance"
function checkDirection(judgment: Judgment): string | null {
  const chance = judgment.breakEven?.resumeChance?.waitFaster ?? null;
  if (chance === null) return "no_chance";
  const text = `${judgment.headline}${judgment.reason ?? ""}`;
  if (judgment.action !== "switch" && chance < 5) {
    return waitReasonPhrases.find((p) => text.includes(p)) ?? null;
  }
  if (judgment.action === "switch" && chance > 5) {
    return switchReasonPhrases.find((p) => text.includes(p)) ?? null;
  }
  return "aligned";
}

describe("行動と分岐点までに動く確率の向き", () => {
  it.each(causes)("$label", async (cause) => {
    const rows = [];
    for (const elapsed of elapsedMinutesList) {
      const judgment = findJudgment(await postJudge(app, buildRequest(cause, elapsed)));
      rows.push({
        elapsed,
        action: judgment.action,
        waitFaster: judgment.breakEven?.resumeChance?.waitFaster ?? null,
        direction: checkDirection(judgment),
      });
    }
    // 逆なのに理由の文が無い行は direction が null になる
    expect(rows.filter((row) => row.direction === null)).toEqual([]);
  });

  it("e2e で見つけた電力の場面は、動く見込みが 1 割未満なので待たずに切り替える", async () => {
    const power: Cause = {
      label: "大分類 power",
      request: { newInput: null, cause: { group: "power", type: null } },
    };
    const judgment = findJudgment(await postJudge(app, buildRequest(power, 10)));
    expect(judgment.breakEven?.resumeChance?.waitFaster).toBe(0);
    expect(judgment.action).toBe("switch");
    expect(judgment.headline).not.toContain("待つ");
  });
});
