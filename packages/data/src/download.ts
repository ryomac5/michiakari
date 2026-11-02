import { existsSync } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceArchive } from "../config/sources.ts";

// 元データの zip を .cache/ に取得する。取得済みなら何もしない

export async function downloadArchive(source: SourceArchive, cacheDir: string): Promise<string> {
  const target = join(cacheDir, source.zipFile);
  if (existsSync(target) && (await stat(target)).size > 0) return target;
  await mkdir(cacheDir, { recursive: true });
  console.log(`取得: ${source.zipUrl}`);
  const res = await fetch(source.zipUrl);
  if (!res.ok) throw new Error(`取得に失敗しました: ${source.zipUrl} (${res.status})`);
  const partial = `${target}.partial`;
  await writeFile(partial, Buffer.from(await res.arrayBuffer()));
  await rename(partial, target);
  return target;
}
