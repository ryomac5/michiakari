"use client";

import { type Dispatch, useCallback, useEffect } from "react";
import type { EntryAction } from "./flow";

// 入口の段を端末の履歴につなぐ。段が 1 つ深くなるたびに同じ URL の履歴を 1 つ積み、
// 端末の戻る操作（popstate）でその深さの段まで引く。URL は変えないので、?mock=1 などはそのまま残る

const depthKey = "entryDepth";

function readHistoryDepth(): number {
  const value = (window.history.state as Record<string, unknown> | null)?.[depthKey];
  return typeof value === "number" ? value : 0;
}

// ready は、判断の画面から戻ったときの段の復元が済んだか。済むまでは履歴に触らない
export function useEntryHistory(depth: number, dispatch: Dispatch<EntryAction>, ready: boolean) {
  // 段と履歴の深さをそろえる。深くなったら積み、履歴のほうが深ければ（判断の画面から戻ったときなど）履歴を引く
  useEffect(() => {
    if (!ready) return;
    const historyDepth = readHistoryDepth();
    if (depth > historyDepth) {
      for (let d = historyDepth + 1; d <= depth; d++) {
        window.history.pushState({ ...window.history.state, [depthKey]: d }, "");
      }
    } else if (depth < historyDepth) {
      window.history.go(depth - historyDepth);
    }
  }, [depth, ready]);

  useEffect(() => {
    function handlePop(e: PopStateEvent) {
      const value = (e.state as Record<string, unknown> | null)?.[depthKey];
      dispatch({ type: "backTo", depth: typeof value === "number" ? value : 0 });
    }
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [dispatch]);

  // 画面の戻るボタンと選び直しも、履歴を引いて端末の戻る操作と同じ道を通す
  return useCallback(
    (target: number) => {
      if (readHistoryDepth() === depth && target < depth) {
        window.history.go(target - depth);
      } else {
        dispatch({ type: "backTo", depth: target });
      }
    },
    [depth, dispatch],
  );
}
