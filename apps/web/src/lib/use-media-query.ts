"use client";

import { useSyncExternalStore } from "react";

// PC 幅の判定。地図の余白やシートの振る舞いを切り替えるのに使う
export const desktopMediaQuery = "(min-width: 1024px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
