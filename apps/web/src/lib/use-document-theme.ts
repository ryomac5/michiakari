"use client";

import { useSyncExternalStore } from "react";
import type { Theme } from "@/i18n/config";

// html のクラスからいまのテーマを読む。切り替えは MutationObserver で拾う

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "light");
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
