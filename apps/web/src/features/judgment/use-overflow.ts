"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

// 行数を切り詰めた要素の中身があふれているか。幅や文が変わったら測り直す
export function useOverflow(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    // 文が変わるたびに測り直す
    if (!el || text === "") return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);

  return overflowing;
}
