import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSceneTimings,
  type SceneTiming,
  saveSceneTimings,
  scenesFile,
} from "./demo-scenes.ts";
import { loadRecordingMarks, type RecordingMarks, recordingMarksFile } from "./recording-marks.ts";

// 録画の後処理。Playwright の動画は頁を読む前の暗い画面から始まるので、最初の画面を描き終えた時点から切り出す
// recordings/<テスト名>/video.webm と recording.json を読み、同じ場所に demo.webm と stills/<場面>.png を書く
// 台本の場面の目印があれば、各場面の秒を recordings/scenes.json に書く。音声を重ねるときに使う
// ffmpeg は PATH のもの、無ければ Playwright が同梱するものを使う。新しい依存は足さない

const e2eDir = fileURLToPath(new URL("..", import.meta.url));
const recordingsDir = join(e2eDir, "recordings");
const rawVideo = "video.webm";
const trimmedVideo = "demo.webm";
// 最初のフレームは頁を作った直後に来る。startedAt との差を吸収するぶん、少し多めに切る
const trimMarginMs = 100;

function findFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const onPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  const found = onPath.status === 0 ? onPath.stdout.trim().split("\n")[0] : undefined;
  if (found) return found;
  // Playwright の同梱 ffmpeg。--dry-run が置き場所を出す
  const dryRun = execFileSync(join(e2eDir, "node_modules/.bin/playwright"), [
    "install",
    "--dry-run",
    "ffmpeg",
  ]).toString();
  const location = dryRun.match(/Install location:\s*(\S.*)/)?.[1]?.trim();
  if (!location || !existsSync(location)) {
    throw new Error("ffmpeg が見つかりません。pnpm --filter e2e exec playwright install ffmpeg");
  }
  const executable = readdirSync(location).find((name) => name.startsWith("ffmpeg"));
  if (!executable) throw new Error(`${location} に ffmpeg の実行ファイルがありません`);
  return join(location, executable);
}

function runFfmpeg(ffmpeg: string, args: string[]): string {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg が失敗しました: ${result.stderr}`);
  return result.stderr;
}

function toSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

// 動画の長さ。ffmpeg -i の出力から読む
function readDuration(ffmpeg: string, file: string): string {
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" });
  return probe.stderr.match(/Duration:\s*([\d:.]+)/)?.[1] ?? "不明";
}

// 最初の画面を描き終えた時点から切り出し、画質は録画より落とさない設定で書き直す
function trimVideo(ffmpeg: string, dir: string, marks: RecordingMarks): number {
  const startMs =
    marks.firstScreenAt === null
      ? 0
      : Date.parse(marks.firstScreenAt) - Date.parse(marks.startedAt) + trimMarginMs;
  runFfmpeg(ffmpeg, [
    "-loglevel",
    "error",
    "-ss",
    toSeconds(startMs),
    "-i",
    join(dir, rawVideo),
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "10",
    "-b:v",
    "0",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    "-row-mt",
    "1",
    join(dir, trimmedVideo),
  ]);
  return startMs;
}

// 静止画に残す点。台本の場面は場面の中ほど、それ以外の目印はその時刻
function listStillPoints(
  marks: RecordingMarks,
  startMs: number,
  scenes: SceneTiming[],
): [string, number][] {
  const sceneNames = new Set(Object.keys(marks.marks).filter((name) => name.startsWith("scene-")));
  const others = Object.entries(marks.marks)
    .filter(([name]) => !sceneNames.has(name))
    .map(([name, at]): [string, number] => [
      name,
      Date.parse(at) - Date.parse(marks.startedAt) - startMs,
    ]);
  const middles = scenes.map((s): [string, number] => [
    `scene-${s.scene}`,
    ((s.start + s.end) / 2) * 1000,
  ]);
  return [...middles, ...others];
}

// 目印の場面を切り出した動画から静止画にする
function writeStills(ffmpeg: string, dir: string, points: [string, number][]): string[] {
  const stillsDir = join(dir, "stills");
  mkdirSync(stillsDir, { recursive: true });
  const written: string[] = [];
  for (const [name, atMs] of points) {
    const output = join(stillsDir, `${name}.png`);
    runFfmpeg(ffmpeg, [
      "-loglevel",
      "error",
      "-ss",
      toSeconds(atMs),
      "-i",
      join(dir, trimmedVideo),
      "-frames:v",
      "1",
      "-f",
      "image2",
      output,
    ]);
    written.push(output);
  }
  return written;
}

function listRecordingDirs(): string[] {
  if (!existsSync(recordingsDir)) return [];
  return readdirSync(recordingsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(recordingsDir, entry.name))
    .filter((dir) => existsSync(join(dir, rawVideo)));
}

async function trimRecordings(): Promise<void> {
  const dirs = listRecordingDirs();
  if (dirs.length === 0) {
    console.log(`[trim-recording] ${recordingsDir} に動画がありません`);
    return;
  }
  const ffmpeg = findFfmpeg();
  for (const dir of dirs) {
    if (!existsSync(join(dir, recordingMarksFile))) {
      console.log(`[trim-recording] ${dir} に ${recordingMarksFile} が無いので切り出さない`);
      continue;
    }
    const marks = await loadRecordingMarks(dir);
    const startMs = trimVideo(ffmpeg, dir, marks);
    const scenes = buildSceneTimings(marks, startMs);
    const stills = writeStills(ffmpeg, dir, listStillPoints(marks, startMs, scenes));
    const output = join(dir, trimmedVideo);
    if (scenes.length > 0) {
      const scenesPath = join(recordingsDir, scenesFile);
      await saveSceneTimings(scenesPath, relative(recordingsDir, output), scenes);
      console.log(`[trim-recording] 場面の秒: ${scenesPath}`);
      for (const s of scenes) {
        console.log(
          `[trim-recording] 場面 ${s.scene}: 台本 ${s.script.seconds} 秒、録画 ${s.seconds} 秒（${s.start}〜${s.end}）`,
        );
      }
    }
    console.log(`[trim-recording] ${toSeconds(startMs)} 秒から切り出した: ${output}`);
    console.log(`[trim-recording] 長さ ${readDuration(ffmpeg, output)}`);
    for (const still of stills) console.log(`[trim-recording] 静止画: ${still}`);
  }
}

await trimRecordings();
