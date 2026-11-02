// サーバー専用。fs を使うのでクライアントから import しない
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkScenarioIntegrity } from "@repo/schema";
import { loadScenarioDir, resolveContentDir } from "@repo/schema/loaders";
import { buildReplayScenario, type ReplayScenario } from "./scenario";

// scenarios/*.yaml を読み、検証に通ったものだけをリプレイ用の抜粋にする
export function loadReplayScenarios(
  dir = join(resolveContentDir(), "scenarios"),
): ReplayScenario[] {
  if (!existsSync(dir)) return [];
  return loadScenarioDir(dir)
    .entries.map((entry) => entry.data)
    .filter((scenario) => checkScenarioIntegrity(scenario).length === 0)
    .map(buildReplayScenario);
}
