import { join } from "node:path";
import type { Knowledge, Scenario } from "@repo/schema";
import { loadKnowledgeDir, loadScenarioDir, resolveContentDir } from "@repo/schema/loaders";

// 知見とシナリオを起動時に読む。読めなかったファイルは数だけ返す

export type ContentStore = {
  knowledge: ReadonlyMap<string, Knowledge>;
  scenarios: ReadonlyMap<string, Scenario>;
  errorCount: number;
};

export function loadContentStore(contentDir: string = resolveContentDir()): ContentStore {
  const knowledge = loadKnowledgeDir(join(contentDir, "knowledge"));
  const scenarios = loadScenarioDir(join(contentDir, "scenarios"));
  return {
    knowledge: new Map(knowledge.entries.map((e) => [e.data.id, e.data])),
    scenarios: new Map(scenarios.entries.map((e) => [e.data.id, e.data])),
    errorCount: knowledge.errors.length + scenarios.errors.length,
  };
}
