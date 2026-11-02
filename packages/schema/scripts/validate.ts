import { findRepoRoot, resolveContentDir } from "../src/loaders.ts";
import { buildValidationReport, watchContentDirs } from "./validate-report.ts";

// knowledge/ と scenarios/ を検証する。既定はリポジトリルート、CONTENT_DIR で切り替える
// --watch を付けると、変更のたびに検証し直す

const repoRoot = findRepoRoot();
const rootDir = resolveContentDir(process.env, repoRoot);
const isDefaultRoot = rootDir === repoRoot;

function runOnce(): boolean {
  const report = buildValidationReport(rootDir, { isDefaultRoot });
  for (const line of report.lines) console.log(line);
  return report.ok;
}

function formatClockNow(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

if (process.argv.includes("--watch")) {
  runOnce();
  console.log("監視中: knowledge/ と scenarios/ の変更を待っています。Ctrl+C で終了します");
  watchContentDirs(rootDir, () => {
    console.log(`\n---- ${formatClockNow()} 変更を検出したので検証し直します ----`);
    runOnce();
    console.log("監視中: 変更を待っています");
  });
} else {
  process.exit(runOnce() ? 0 : 1);
}
