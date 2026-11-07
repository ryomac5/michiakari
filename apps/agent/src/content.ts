import { join } from "node:path";
import type { Scenario } from "@repo/schema";
import { loadScenarioDir, resolveContentDir } from "@repo/schema/loaders";

// リプレイのシナリオを起動時に読む。読めなかったファイルは数だけ返す
// 判断は知見を読まない。材料は core の規則表と統計値、利用者が持ち込んだ発表と放送に限る

export type ContentStore = {
  scenarios: ReadonlyMap<string, Scenario>;
  errorCount: number;
};

export function loadContentStore(contentDir: string = resolveContentDir()): ContentStore {
  const scenarios = loadScenarioDir(join(contentDir, "scenarios"));
  return {
    scenarios: new Map(scenarios.entries.map((e) => [e.data.id, e.data])),
    errorCount: scenarios.errors.length,
  };
}
