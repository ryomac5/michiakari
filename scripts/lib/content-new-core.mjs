// 雛形から知見とシナリオの新しいファイルを作るための部品
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export const CONTENT_KINDS = {
  knowledge: { dir: "knowledge", label: "知見", command: "pnpm knowledge:new <event_id>" },
  scenario: {
    dir: "scenarios",
    label: "シナリオ",
    command: "pnpm scenario:new <scenario_id> --event <event_id>",
  },
};

export class ContentNewError extends Error {}

// 引数を読む。knowledge は id だけ、scenario は id と --event を取る
export const parseContentArgs = (kind, argv) => {
  const spec = CONTENT_KINDS[kind];
  if (!spec) throw new ContentNewError(`種類が不明です: ${kind}`);
  const positional = [];
  let eventId;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--event") {
      eventId = argv[++i];
    } else if (arg.startsWith("--event=")) {
      eventId = arg.slice("--event=".length);
    } else if (arg.startsWith("-")) {
      throw new ContentNewError(`不明なオプションです: ${arg}\n使い方: ${spec.command}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) throw new ContentNewError(`使い方: ${spec.command}`);
  const [id] = positional;
  assertId(id, "id");
  if (kind === "knowledge") {
    if (eventId !== undefined) throw new ContentNewError(`使い方: ${spec.command}`);
    return { id };
  }
  if (!eventId)
    throw new ContentNewError(`--event で知見の id を指定してください\n使い方: ${spec.command}`);
  assertId(eventId, "--event");
  return { id, eventId };
};

const assertId = (value, name) => {
  if (!ID_PATTERN.test(value)) {
    throw new ContentNewError(
      `${name} は英小文字で始め、英小文字・数字・_ だけで書いてください: ${value}`,
    );
  }
};

// 雛形の id 行などを置き換える。置き換え先が見つからなければ失敗にする
const replaceLine = (text, pattern, line) => {
  if (!pattern.test(text)) throw new ContentNewError(`雛形に置き換える行がありません: ${pattern}`);
  return text.replace(pattern, line);
};

export const renderFromTemplate = (kind, templateText, { id, eventId }) => {
  if (kind === "knowledge") {
    return replaceLine(templateText, /^id: TODO_event_id\b.*$/m, `id: ${id}`);
  }
  const withId = replaceLine(templateText, /^id: TODO_scenario_id\b.*$/m, `id: ${id}`);
  // 行末のコメントは残す
  return replaceLine(withId, /^event_type: TODO\b(.*)$/m, `event_type: ${eventId}$1`);
};

export const resolveTargetPath = (rootDir, kind, id) => {
  const dir = CONTENT_KINDS[kind].dir;
  return { path: join(rootDir, dir, `${id}.yaml`), relPath: `${dir}/${id}.yaml` };
};

// 雛形から新しいファイルを作る。既存のファイルは上書きしない
export const createContentFile = (rootDir, kind, args) => {
  const { dir } = CONTENT_KINDS[kind];
  const templatePath = join(rootDir, dir, "_template.yaml");
  if (!existsSync(templatePath))
    throw new ContentNewError(`雛形がありません: ${dir}/_template.yaml`);
  const { path, relPath } = resolveTargetPath(rootDir, kind, args.id);
  if (existsSync(path)) throw new ContentNewError(`すでにあるので作りません: ${relPath}`);

  const text = renderFromTemplate(kind, readFileSync(templatePath, "utf8"), args);
  try {
    writeFileSync(path, text, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new ContentNewError(`すでにあるので作りません: ${relPath}`);
    throw error;
  }
  return { path, relPath };
};

// 作ったあとに表示する手順
export const buildNextSteps = (kind, relPath, { eventId, knowledgeExists, branch } = {}) => {
  const lines = [`作成しました: ${relPath}`];
  if (kind === "scenario" && !knowledgeExists) {
    lines.push(
      `注意: knowledge/${eventId}.yaml がまだありません。pnpm knowledge:new ${eventId} で作れます`,
    );
  }
  if (branch && branch !== "main") {
    lines.push(`注意: いまのブランチは ${branch} です。知見とシナリオは main で書いて承認します`);
  }
  const fill =
    kind === "knowledge"
      ? "TODO を埋めます。書き方は docs/guides/knowledge-authoring.html にあります"
      : `TODO を埋めます。phase と evidence_includes には knowledge/${eventId}.yaml の id を書きます`;
  lines.push(
    "次の手順:",
    `  1. ${relPath} を開き、${fill}`,
    "  2. pnpm validate で確かめます。pnpm validate --watch なら保存のたびに検証します",
    "  3. ALLOW_PROTECTED_EDIT=1 pnpm guard:approve で承認します",
    "  4. git add と git commit で記録します",
  );
  return lines;
};
