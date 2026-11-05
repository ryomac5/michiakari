"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SheetSnap } from "@/components/MapSheet";
import { prefersReducedMotion } from "@/lib/use-document-theme";
import { testIds } from "./testids";

// シートを開くのにかかる時間。開き終えてから選択肢の行へ動かす
const sheetOpenMs = 320;
// 選択肢の行を目立たせておく時間
const highlightMs = 2400;

function clearTimers(ids: readonly number[]): void {
  for (const id of ids) window.clearTimeout(id);
}

// 地図の吹き出しを押したとき、シートを全部開いてその選択肢の行を見せ、しばらく目立たせる
export function useOptionFocus(setSnap: (snap: SheetSnap) => void) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => clearTimers(timers.current), []);

  const focusOption = useCallback(
    (optionId: string) => {
      clearTimers(timers.current);
      setSnap("full");
      setHighlightId(optionId);
      timers.current = [
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>(`[data-testid="${testIds.judgment.option(optionId)}"]`)
            ?.scrollIntoView({
              block: "center",
              behavior: prefersReducedMotion() ? "auto" : "smooth",
            });
        }, sheetOpenMs),
        window.setTimeout(() => setHighlightId(null), highlightMs),
      ];
    },
    [setSnap],
  );

  return { highlightId, focusOption };
}

// 選択肢の一覧で押した選択肢。地図をその経路に描き直すため、シートを閉じて地図を見せる
// 新しい判断が届いたら推奨に戻す
export function useOptionSelection(setSnap: (snap: SheetSnap) => void, judgedAt: string | null) {
  const [selected, setSelected] = useState<{ id: string; judgedAt: string | null } | null>(null);
  const selectOption = useCallback(
    (optionId: string) => {
      setSelected({ id: optionId, judgedAt });
      setSnap("collapsed");
    },
    [setSnap, judgedAt],
  );
  const selectedOptionId = selected?.judgedAt === judgedAt ? selected.id : null;
  return { selectedOptionId, selectOption };
}
