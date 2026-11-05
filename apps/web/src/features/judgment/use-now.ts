"use client";

import { useEffect, useState } from "react";

// 一定間隔で更新される現在時刻。サーバー描画との食い違いを避けるため初回は null
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
