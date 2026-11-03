import { type ChildProcess, spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebEnv, webCommand, webUrl } from "../servers.ts";

// 録画の前に、本物のフォントを next dev の永続キャッシュへ取り込む
// next dev はフォントの取得が一度でも時間切れになると、その起動のあいだ 500 を返し続ける
// 取れた分はキャッシュに残るので、200 が返るまで起動し直す。録画の起動はキャッシュから速く立ち上がる

const maxAttempts = 6;
const requestTimeoutMs = 3 * 60_000;
const pollIntervalMs = 1000;
// キャッシュの書き出しを待つ間隔と、大きさが変わらなければ書き終えたとみなす時間
const persistPollMs = 2000;
const persistStableMs = 8000;
const persistTimeoutMs = 2 * 60_000;
const noGrowthMs = 30_000;
const e2eDir = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = join(e2eDir, "../apps/web/.next/dev/cache");
const probeUrl = `${webUrl}/replay`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 応答の状態。つながらなければ null
async function probe(): Promise<number | null> {
  try {
    const response = await fetch(probeUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return null;
  }
}

function startWeb(): ChildProcess {
  return spawn(webCommand, {
    cwd: e2eDir,
    env: { ...process.env, ...buildWebEnv({ stubExternal: false }) },
    shell: true,
    detached: true,
    stdio: "ignore",
  });
}

// プロセスグループごと止め、終わるまで待つ
async function stopWeb(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  if (child.exitCode === null) process.kill(-child.pid, "SIGKILL");
}

// 起動してから最初の応答の状態を返す。つながるまで待つ
async function waitForFirstResponse(child: ChildProcess): Promise<number | null> {
  const deadline = Date.now() + requestTimeoutMs;
  while (Date.now() < deadline && child.exitCode === null) {
    const status = await probe();
    if (status !== null) return status;
    await sleep(pollIntervalMs);
  }
  return null;
}

async function measureDirBytes(dir: string): Promise<number> {
  try {
    const names = await readdir(dir, { recursive: true });
    const sizes = await Promise.all(
      names.map((name) =>
        stat(join(dir, name)).then(
          (s) => (s.isFile() ? s.size : 0),
          () => 0,
        ),
      ),
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}

// next dev はキャッシュを動いている間に書き出す。止める前に、書き出しが落ち着くまで待つ
// 起動前から増えなければ、書き出すものが無かったとみなす
async function waitForCachePersisted(child: ChildProcess, startBytes: number): Promise<void> {
  const startedAt = Date.now();
  let last = startBytes;
  let stableSince = startedAt;
  let grown = false;
  while (Date.now() - startedAt < persistTimeoutMs && child.exitCode === null) {
    await sleep(persistPollMs);
    const bytes = await measureDirBytes(cacheDir);
    if (bytes !== last) {
      grown = true;
      last = bytes;
      stableSince = Date.now();
      continue;
    }
    if (grown && Date.now() - stableSince >= persistStableMs) return;
    if (!grown && Date.now() - startedAt >= noGrowthMs) return;
  }
}

async function warmWeb(): Promise<void> {
  // すでに動いているサーバーは止められないので、そのまま録画に任せる
  const existing = await probe();
  if (existing !== null) {
    console.log(`[warm-web] ${webUrl} は起動済み（${existing}）。温めを省く`);
    return;
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startBytes = await measureDirBytes(cacheDir);
    const child = startWeb();
    const status = await waitForFirstResponse(child);
    await waitForCachePersisted(child, startBytes);
    await stopWeb(child);
    console.log(`[warm-web] ${attempt} 回目の起動: ${status ?? "応答なし"}`);
    if (status === 200) return;
  }
  throw new Error(`[warm-web] ${maxAttempts} 回起動しても ${probeUrl} が 200 を返しません`);
}

await warmWeb();
