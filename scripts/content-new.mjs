// 雛形から scenarios/ の新しいファイルを作る。開発者が端末で実行する
// 使い方: pnpm scenario:new <scenario_id> --event <event_id>
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNextSteps,
  CONTENT_KINDS,
  ContentNewError,
  createContentFile,
  parseContentArgs,
} from "./lib/content-new-core.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [kind, ...argv] = process.argv.slice(2);
const command =
  CONTENT_KINDS[kind]?.command ?? "pnpm scenario:new <scenario_id> --event <event_id>";

const reject = (message) => {
  console.error(`${kind ?? "content"}:new: ${message}`);
  process.exit(1);
};

const readBranch = () => {
  try {
    return execFileSync("git", ["-C", rootDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

// 書き込み先は保護領域なので、開発者が明示したときだけ書く
// biome-ignore lint/suspicious/noUndeclaredEnvVars: turbo を経由せず開発者が直接設定する
if (process.env.ALLOW_PROTECTED_EDIT !== "1") {
  reject(
    `ALLOW_PROTECTED_EDIT=1 が設定されていないため拒否します\n使い方: ALLOW_PROTECTED_EDIT=1 ${command}`,
  );
}

try {
  const args = parseContentArgs(kind, argv);
  const { relPath } = createContentFile(rootDir, kind, args);
  const steps = buildNextSteps(relPath, { branch: readBranch() });
  for (const line of steps) console.log(line);
} catch (error) {
  if (error instanceof ContentNewError) reject(error.message);
  throw error;
}
