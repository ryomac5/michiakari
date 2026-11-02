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
