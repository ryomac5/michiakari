import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// 録画の時刻の目印。録画と同じ出力先に書き、trim-recording.ts が切り出しと静止画に使う
// 時刻はすべて壁時計の ISO 文字列。動画の 0 秒は startedAt にほぼ一致する

export const recordingMarksFile = "recording.json";

export type RecordingMarks = {
  // テストの本体に入った時刻。頁は作られた直後で、録画の最初のフレームと同じころ
  startedAt: string;
  // 最初の画面を描き終えた時刻。動画はここから切り出す
  firstScreenAt: string | null;
  // 静止画に残す場面の名前と時刻
  marks: Record<string, string>;
};

export function createRecordingMarks(): RecordingMarks {
  return { startedAt: new Date().toISOString(), firstScreenAt: null, marks: {} };
}

export function markFirstScreen(marks: RecordingMarks): void {
  marks.firstScreenAt = new Date().toISOString();
}

export function markScene(marks: RecordingMarks, name: string): void {
  marks.marks[name] = new Date().toISOString();
}

// 出力先は Playwright が動画を書くときに作るので、先に書くときは自分で作る
export async function saveRecordingMarks(dir: string, marks: RecordingMarks): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, recordingMarksFile), `${JSON.stringify(marks, null, 2)}\n`);
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// 目印の読み込み。形が違えば理由を付けて止める
export async function loadRecordingMarks(dir: string): Promise<RecordingMarks> {
  const path = join(dir, recordingMarksFile);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path} の形が違います`);
  const { startedAt, firstScreenAt, marks } = parsed as Record<string, unknown>;
  if (!isIsoString(startedAt)) throw new Error(`${path} の startedAt が時刻ではありません`);
  if (firstScreenAt !== null && !isIsoString(firstScreenAt)) {
    throw new Error(`${path} の firstScreenAt が時刻ではありません`);
  }
  if (typeof marks !== "object" || marks === null) throw new Error(`${path} の marks が無い`);
  for (const [name, at] of Object.entries(marks)) {
    if (!isIsoString(at)) throw new Error(`${path} の marks.${name} が時刻ではありません`);
  }
  return { startedAt, firstScreenAt, marks: marks as Record<string, string> };
}
