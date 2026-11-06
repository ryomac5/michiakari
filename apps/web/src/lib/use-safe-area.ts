"use client";

import { useSyncExternalStore } from "react";

// 端末の画面の端の余白（env(safe-area-inset-*)）を px で読む。JS で高さを組む地図とシートに使う
// 上部の帯は max(12px, 上の余白) から始まるので、帯の下端が 12px を超えて下がるぶんも返す

export type SafeArea = { top: number; bottom: number };

const noSafeArea: SafeArea = { top: 0, bottom: 0 };
let cached: SafeArea = noSafeArea;
let probe: HTMLDivElement | null = null;

function measureSafeArea(): SafeArea {
  if (!probe) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
  }
  const style = getComputedStyle(probe);
  const next = {
    top: Number.parseFloat(style.paddingTop) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
  };
  if (next.top !== cached.top || next.bottom !== cached.bottom) cached = next;
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

export function useSafeArea(): SafeArea {
  return useSyncExternalStore(subscribe, measureSafeArea, () => noSafeArea);
}

// 上部の帯の上の余白は 12px。端末の余白がそれより大きいと、帯がその差だけ下がる
export function computeHeaderShift(safe: SafeArea): number {
  return Math.max(0, safe.top - 12);
}
