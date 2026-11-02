"use client";

import { useEffect, useState } from "react";
import type { StationChoice } from "./catalog";
import { fetchStationChoices } from "./client";

// 入力が落ち着いてからサーバーで駅を探す。古い要求は取り消す

export type StationSearchStatus = "idle" | "loading" | "ready" | "error";

const debounceMs = 150;

export function useStationSearch(query: string): {
  status: StationSearchStatus;
  results: StationChoice[];
} {
  const trimmed = query.trim();
  const [state, setState] = useState<{
    query: string;
    status: StationSearchStatus;
    results: StationChoice[];
  }>({ query: "", status: "idle", results: [] });

  useEffect(() => {
    if (trimmed === "") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((prev) => ({ ...prev, query: trimmed, status: "loading" }));
      fetchStationChoices(trimmed, controller.signal)
        .then((results) => setState({ query: trimmed, status: "ready", results }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({ query: trimmed, status: "error", results: [] });
          }
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (trimmed === "") return { status: "idle", results: [] };
  // 入力直後で結果が古いあいだは読み込み中として扱い、前の結果は残して見せる
  if (state.query !== trimmed && state.status !== "loading") {
    return { status: "loading", results: state.results };
  }
  return { status: state.status, results: state.results };
}
