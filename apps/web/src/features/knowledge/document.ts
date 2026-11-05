import type { Knowledge } from "@repo/schema";

// 知見の閲覧画面に出す 1 ファイルぶんの内容。構造化した知見と、YAML の該当部分の抜粋を持つ

export type YamlExcerpt = {
  // 1 始まりの行番号
  startLine: number;
  endLine: number;
  text: string;
};

export type KnowledgeDocument = {
  knowledge: Knowledge;
  fileName: string;
  // 開発用のダミーか。ファイル冒頭の注記で見分ける
  dummy: boolean;
  excerpts: {
    // id から identification まで
    header: YamlExcerpt;
    phases: Record<string, YamlExcerpt>;
    // after_resume から末尾まで
    rest: YamlExcerpt;
  };
};

type LocateLine = (path: readonly (string | number)[]) => number | undefined;

const dummyMarker = "開発用のダミー";

// ファイル冒頭のコメントに開発用のダミーである旨が書かれているか
export function detectDummyContent(text: string): boolean {
  const leading = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("#")) break;
    leading.push(trimmed);
  }
  return leading.some((line) => line.includes(dummyMarker));
}

// 行番号の範囲を切り出す。末尾の空行は落とす
export function sliceYamlLines(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): YamlExcerpt {
  let end = Math.min(endLine, lines.length);
  while (end > startLine && (lines[end - 1] ?? "").trim() === "") end--;
  return {
    startLine,
    endLine: end,
    text: lines.slice(startLine - 1, end).join("\n"),
  };
}

// 最上位のキーが書かれた行。見つからなければ undefined
function findTopLevelKeyLine(lines: readonly string[], key: string): number | undefined {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  return index === -1 ? undefined : index + 1;
}

export function buildKnowledgeDocument(params: {
  knowledge: Knowledge;
  text: string;
  fileName: string;
  locateLine: LocateLine;
}): KnowledgeDocument {
  const { knowledge, text, fileName, locateLine } = params;
  const lines = text.split("\n");
  const phasesKey = findTopLevelKeyLine(lines, "phases") ?? lines.length;
  const restStart = findTopLevelKeyLine(lines, "after_resume") ?? lines.length + 1;
  const phaseStarts = knowledge.phases.map((_, i) => locateLine(["phases", i]) ?? phasesKey);

  const phases: Record<string, YamlExcerpt> = {};
  knowledge.phases.forEach((phase, i) => {
    const start = phaseStarts[i] ?? phasesKey;
    const next = phaseStarts[i + 1] ?? restStart;
    phases[phase.id] = sliceYamlLines(lines, start, next - 1);
  });

  return {
    knowledge,
    fileName,
    dummy: detectDummyContent(text),
    excerpts: {
      header: sliceYamlLines(lines, 1, phasesKey - 1),
      phases,
      rest: sliceYamlLines(lines, restStart, lines.length),
    },
  };
}
