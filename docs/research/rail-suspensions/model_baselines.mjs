// 実績の結末を入力せず、現在の core で発生直後の再開までの見込みを計算する。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { estimateBranchAwareRemaining } from "../../../packages/core/src/remaining-paths.ts";
import { loadKnowledgeDir } from "../../../packages/schema/src/loaders.ts";

const directory = fileURLToPath(
  new URL("../../../packages/schema/test/fixtures/dev-content/knowledge/", import.meta.url),
);
const loaded = loadKnowledgeDir(directory);
if (loaded.errors.length) throw new Error(JSON.stringify(loaded.errors));
const mapping = [
  { event: "person_accident", category: "person_accident", start: "initial" },
  { event: "vehicle_failure", category: "vehicle_failure", start: "initial" },
  { event: "heavy_rain", category: "natural_rain", start: "suspended" },
];
const rows = mapping.map(({ event, category, start }) => {
  const entry = loaded.entries.find((item) => item.data.id === event);
  if (!entry) throw new Error(`知見がありません: ${event}`);
  const startIndex = entry.data.phases.findIndex((phase) => phase.id === start);
  if (startIndex < 0) throw new Error(`開始段階がありません: ${start}`);
  // 記録の終点は運転再開。乗れる列車までの待ちを評価対象に混ぜない。
  const knowledge = {
    ...entry.data,
    phases: entry.data.phases.slice(startIndex),
    after_resume: {
      ...entry.data.after_resume,
      first_train_wait_minutes: { p50: 0, p80: 0 },
    },
  };
  const { remaining } = estimateBranchAwareRemaining(knowledge, start, 0, {
    elapsedSinceOnsetMinutes: 0,
  });
  return {
    event,
    cause_category: category,
    predicted_p50: remaining.p50,
    predicted_p80: remaining.p80,
    knowledge_sha256: createHash("sha256").update(readFileSync(entry.file)).digest("hex"),
    basis: "development_fixture_at_suspension_onset_without_later_signals",
  };
});
process.stdout.write(`${JSON.stringify(rows)}\n`);
