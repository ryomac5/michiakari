"use client";

import { type Dispatch, useCallback, useEffect, useRef } from "react";
import { type EntryAction, selectEntryHistoryAction } from "./flow";

// 入口の段を端末の履歴につなぐ。段が 1 つ深くなるたびに同じ URL の履歴を 1 つ積み、
// 端末の戻る操作（popstate）でその深さの段まで引く。URL は変えないので、?mock=1 などはそのまま残る

const depthKey = "entryDepth";

function readDepth(state: unknown): number | null {
  const value = (state as Record<string, unknown> | null)?.[depthKey];
  return typeof value === "number" ? value : null;
}

function readHistoryDepth(): number | null {
  return readDepth(window.history.state);
}

// ready は、判断の画面から戻ったときの段の復元が済んだか。済むまでは履歴に触らない
export function useEntryHistory(depth: number, dispatch: Dispatch<EntryAction>, ready: boolean) {
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const initializedRef = useRef(false);
  // 自分で履歴を引いたときの行き先の深さ。その popstate は段を変えない
  const pendingRef = useRef<number | null>(null);

  const travel = useCallback((target: number, from: number) => {
    pendingRef.current = target;
    window.history.go(target - from);
  }, []);

  // 復元時は履歴に段を合わせ、通常の進行・選び直しでは段に履歴を合わせる
  useEffect(() => {
    if (!ready || window.location.pathname !== "/" || pendingRef.current !== null) return;
    const storedDepth = readHistoryDepth();
    const action = selectEntryHistoryAction(depth, storedDepth, !initializedRef.current);
    // backTo による段の更新が反映されるまで復元扱いを保つ（Strict Mode の再実行も同じ）。
    initializedRef.current = action.type !== "restore";
    switch (action.type) {
      case "restore":
        dispatch({ type: "backTo", depth: action.depth });
        break;
      case "write":
        if (action.initialize) {
          window.history.replaceState({ ...window.history.state, [depthKey]: 0 }, "");
        }
        for (let d = action.from + 1; d <= action.to; d++) {
          window.history.pushState({ ...window.history.state, [depthKey]: d }, "");
        }
        break;
      case "travel":
        travel(action.depth, storedDepth ?? 0);
        break;
      case "none":
        break;
    }
  }, [depth, dispatch, ready, travel]);

  useEffect(() => {
    function handlePop(e: PopStateEvent) {
      const value = readDepth(e.state);
      // 復元前や別画面への移動はルーターに任せ、入口の段として扱わない。
      if (!readyRef.current || window.location.pathname !== "/" || value === null) return;
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
