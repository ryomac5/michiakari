import { join } from "node:path";
import { findRepoRoot } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import { loadReplayScenarios } from "./load-scenarios";
import { buildReplayRequest, pickScenarioText, resolveScenarioTime } from "./scenario";

// 開発用のダミーシナリオを読む（読むだけで変更しない）
const devScenarioDir = join(findRepoRoot(), "packages/schema/test/fixtures/dev-content/scenarios");

describe("resolveScenarioTime", () => {
  it("開始時刻に経過分を足し、日本時間で返す", () => {
    expect(resolveScenarioTime("2026-11-05T22:10:00+09:00", 22)).toBe("2026-11-05T22:32:00+09:00");
    expect(resolveScenarioTime("2026-11-05T23:50:00+09:00", 15.5)).toBe(
      "2026-11-06T00:05:30+09:00",
    );
    expect(resolveScenarioTime("2026-11-05T13:10:00Z", 0)).toBe("2026-11-05T22:10:00+09:00");
  });
});

describe("loadReplayScenarios", () => {
  it("検証に通ったシナリオを、期待値を除いた抜粋にして返す", () => {
    const scenarios = loadReplayScenarios(devScenarioDir);
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      expect(s.timeline.length).toBeGreaterThan(0);
      expect(s).not.toHaveProperty("expectations");
      expect(s).not.toHaveProperty("ground_truth");
    }
  });

  it("ディレクトリが無ければ空を返す", () => {
    expect(loadReplayScenarios(join(devScenarioDir, "missing"))).toEqual([]);
  });
});

describe("buildReplayRequest", () => {
  const [scenario] = loadReplayScenarios(devScenarioDir);

  it("観測を scenario 型の入力にし、時刻と利用者の条件をシナリオから組み立てる", () => {
    if (!scenario) throw new Error("ダミーシナリオがありません");
    const entry = scenario.timeline.at(-1);
    if (!entry) throw new Error("timeline が空です");
    const request = buildReplayRequest(scenario, entry, [], "en");

    expect(request.newInput).toEqual({
      type: "scenario",
      scenarioId: scenario.id,
      observationId: entry.id,
      kind: entry.kind,
      text: entry.text,
    });
    expect(request.now).toBe(resolveScenarioTime(scenario.start_time, entry.offset_minutes));
    expect(request.origin).toEqual({ kind: "station", name: scenario.user.current_station });
    expect(request.destination).toEqual({ kind: "station", name: scenario.user.destination });
    expect(request.constraints.knowsAlternatives).toBe(
      scenario.user.constraints.knows_alternatives,
    );
    expect(request.language).toBe("en");
  });

  it("deadline は開始時刻以降の最初の時刻にする", () => {
    const withDeadline = loadReplayScenarios(devScenarioDir).find(
      (s) => s.user.constraints.deadline !== null,
    );
    if (!withDeadline) return;
    const [first] = withDeadline.timeline;
    if (!first) throw new Error("timeline が空です");
    const deadline = buildReplayRequest(withDeadline, first, [], "ja").constraints.deadline;
    expect(deadline).not.toBeNull();
    expect(Date.parse(deadline ?? "")).toBeGreaterThan(Date.parse(withDeadline.start_time));
  });
});

describe("pickScenarioText", () => {
  it("英語が無ければ日本語を返す", () => {
    expect(pickScenarioText({ ja: "見合わせ", en: "Suspended" }, "en")).toBe("Suspended");
    expect(pickScenarioText({ ja: "見合わせ" }, "en")).toBe("見合わせ");
    expect(pickScenarioText({ ja: "見合わせ", en: "Suspended" }, "ja")).toBe("見合わせ");
  });
});
