import type { IncomingMessage } from "node:http";
import type { Context } from "hono";

// 固定窓のリクエスト頻度制限。プロセス内のメモリで数える

export type RateLimiter = {
  // 受け付けてよければ true
  consume(key: string, nowMs: number): boolean;
};

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { startMs: number; count: number }>();
  return {
    consume(key, nowMs) {
      const current = windows.get(key);
      if (!current || nowMs - current.startMs >= windowMs) {
        // 古い窓を掃除して、記録が増え続けないようにする
        for (const [k, w] of windows) if (nowMs - w.startMs >= windowMs) windows.delete(k);
        windows.set(key, { startMs: nowMs, count: 1 });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}

// 頻度制限の単位。trustProxy のときだけ X-Forwarded-For の先頭を使い、既定は接続元アドレス
export function resolveClientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  // @hono/node-server は Node の受信リクエストを env.incoming に入れる
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  return env?.incoming?.socket.remoteAddress ?? "anonymous";
}
