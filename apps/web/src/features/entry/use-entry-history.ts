"use client";

import { type Dispatch, useCallback, useEffect, useRef } from "react";
import type { EntryAction } from "./flow";

// 入口の段を端末の履歴につなぐ。段が 1 つ深くなるたびに同じ URL の履歴を 1 つ積み、
// 端末の戻る操作（popstate）でその深さの段まで引く。URL は変えないので、?mock=1 などはそのまま残る

const depthKey = "entryDepth";

function readDepth(state: unknown): number {
  const value = (state as Record<string, unknown> | null)?.[depthKey];
  return typeof value === "number" ? value : 0;
}

function readHistoryDepth(): number {
  return readDepth(window.history.state);
}

// ready は、判断の画面から戻ったときの段の復元が済んだか。済むまでは履歴に触らない
export function useEntryHistory(depth: number, dispatch: Dispatch<EntryAction>, ready: boolean) {
  const depthRef = useRef(depth);
  depthRef.current = depth;
  // 自分で履歴を引いたときの行き先の深さ。その popstate は段を変えない
  const pendingRef = useRef<number | null>(null);

  const travel = useCallback((target: number, from: number) => {
    pendingRef.current = target;
    window.history.go(target - from);
  }, []);

  // 段と履歴の深さをそろえる。深くなったら積み、履歴のほうが深ければ（判断の画面から戻ったときなど）履歴を引く
  useEffect(() => {
    if (!ready) return;
    const historyDepth = readHistoryDepth();
    if (depth > historyDepth) {
      for (let d = historyDepth + 1; d <= depth; d++) {
        window.history.pushState({ ...window.history.state, [depthKey]: d }, "");
      }
    } else if (depth < historyDepth) {
      travel(depth, historyDepth);
    }
  }, [depth, ready, travel]);

  useEffect(() => {
    function handlePop(e: PopStateEvent) {
      const value = readDepth(e.state);
      const current = depthRef.current;
      if (pendingRef.current === value) {
        // 自分で引いた履歴が着いた。段はもう合っている
        pendingRef.current = null;
        dispatch({ type: "backTo", depth: value });
        return;
      }
      pendingRef.current = null;
      // 利用者の戻る操作。履歴が段より深いままでも、1 回の戻るで 1 段だけ引く
      // 残りの差は上の効果が履歴を引いてそろえる
      dispatch({ type: "backTo", depth: value >= current ? current - 1 : value });
    }
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [dispatch]);

  // 画面の戻るボタンと選び直しも、履歴を引いて端末の戻る操作と同じ道を通す
  return useCallback(
    (target: number) => {
      if (readHistoryDepth() === depth && target < depth) {
        travel(target, depth);
      } else {
        dispatch({ type: "backTo", depth: target });
      }
    },
    [depth, dispatch, travel],
  );
}
