import { writeFile } from "node:fs/promises";
import type { RecordingMarks } from "./recording-marks.ts";

// デモ動画の台本（docs/demo-script.md）の場面と秒数。録画の手順と後処理で共有する
// 場面 11 の字幕は録画の外なので含めない。場面 10 は対比の結末のカードを見せる部分だけを撮る

export type DemoScene = { scene: number; title: string; start: number; end: number };

export const demoScenes: readonly DemoScene[] = [
  { scene: 1, title: "開始画面", start: 0, end: 25 },
  { scene: 2, title: "入口。現在地、地図、駅と駅の間", start: 25, end: 42 },
  { scene: 3, title: "起きていることの 10 の選択肢", start: 42, end: 54 },
  { scene: 4, title: "リプレイの最初の判断", start: 54, end: 73 },
  { scene: 5, title: "2 倍速で進め、判断が変わった瞬間", start: 73, end: 98 },
  { scene: 6, title: "地図とバスを確かめる欄", start: 98, end: 120 },
  { scene: 7, title: "駅と駅の間の車内の判断", start: 120, end: 135 },
  { scene: 8, title: "結末のカード", start: 135, end: 148 },
  { scene: 9, title: "対比のシナリオ", start: 148, end: 158 },
  { scene: 10, title: "結び。対比の結末のカード", start: 158, end: 172 },
];

export const scenesFile = "scenes.json";
// 最後の場面の終わりの目印
export const scenesEndMark = "scene-end";

export function sceneMarkName(scene: number): string {
  return `scene-${scene}`;
}

export function findDemoScene(scene: number): DemoScene {
  const found = demoScenes.find((s) => s.scene === scene);
  if (!found) throw new Error(`台本に場面 ${scene} がありません`);
  return found;
}

export type SceneTiming = {
  scene: number;
  title: string;
  script: { start: number; end: number; seconds: number };
  start: number;
  end: number;
  seconds: number;
};

function roundSeconds(ms: number): number {
  return Math.round(Math.max(0, ms) / 100) / 10;
}

// 目印から、切り出した動画の上での各場面の始まりと終わりの秒を求める。startMs は切り出した位置
export function buildSceneTimings(marks: RecordingMarks, startMs: number): SceneTiming[] {
  const toVideoMs = (at: string) => Date.parse(at) - Date.parse(marks.startedAt) - startMs;
  const recorded = demoScenes.filter((s) => marks.marks[sceneMarkName(s.scene)]);
  return recorded.map((s, i) => {
    const startAt = marks.marks[sceneMarkName(s.scene)] as string;
    const next = recorded[i + 1];
    const endAt = next ? marks.marks[sceneMarkName(next.scene)] : marks.marks[scenesEndMark];
    if (!endAt) throw new Error(`場面 ${s.scene} の終わりの目印がありません`);
    const start = roundSeconds(toVideoMs(startAt));
    const end = roundSeconds(toVideoMs(endAt));
    return {
      scene: s.scene,
      title: s.title,
      script: { start: s.start, end: s.end, seconds: s.end - s.start },
      start,
      end,
      seconds: Math.round((end - start) * 10) / 10,
    };
  });
}

export async function saveSceneTimings(
  path: string,
  video: string,
  timings: SceneTiming[],
): Promise<void> {
  await writeFile(path, `${JSON.stringify({ video, scenes: timings }, null, 2)}\n`);
}
