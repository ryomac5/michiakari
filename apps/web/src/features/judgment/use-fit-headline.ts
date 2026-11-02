"use client";

import { type RefObject, useLayoutEffect, useState } from "react";
import { chooseHeadlineSize, headlineSizesRem, pickInitialHeadlineSize } from "./headline";

// 見出しを各大きさで測り、行数の条件に合う最も大きい文字を選ぶ。幅が変わったら測り直す
export function useFitHeadline(ref: RefObject<HTMLElement | null>, text: string): number {
  const [sizeIndex, setSizeIndex] = useState(() => pickInitialHeadlineSize(text));

  useLayoutEffect(() => {
    const el = ref.current;
    // 見出しの文が変わるたびに測り直す
    if (!el || text === "") return;

    function applyFittedSize(target: HTMLElement) {
      // 測り終えたら React が描いた大きさに戻し、変わる場合だけ描き直させる
      const rendered = target.style.fontSize;
      const linesBySize = headlineSizesRem.map((rem) => {
        target.style.fontSize = `${rem}rem`;
        const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
        return Math.round(target.scrollHeight / lineHeight);
      });
      target.style.fontSize = rendered;
      setSizeIndex(chooseHeadlineSize(linesBySize));
    }

    applyFittedSize(el);
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      applyFittedSize(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);

  return sizeIndex;
}
