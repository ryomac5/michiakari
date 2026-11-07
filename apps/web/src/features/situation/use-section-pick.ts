"use client";

import type { Section } from "@repo/schema";
import { useMemo } from "react";
import { type SectionPick, useJudgmentSession } from "@/features/judgment/session";
import type { MapSectionPick } from "@/features/map/section-pick";

// 地図で押した駅を区間の端にする。2 つ目の駅で区間が決まる。同じ駅をもう一度押せば選び直す
export function stepSectionPick(
  pick: SectionPick,
  stationName: string,
): { pick: SectionPick | null; section: Section | null } {
  if (pick.first === null) return { pick: { first: stationName }, section: null };
  if (pick.first === stationName) return { pick: { first: null }, section: null };
  return { pick: null, section: { fromStation: pick.first, toStation: stationName } };
}

// 区間を選んでいる間だけ、地図に渡す値を返す。決まった区間は答えとして足す
export function useSectionPick(): MapSectionPick | null {
  const { sectionPick, setSectionPick, originLine, addAnswer } = useJudgmentSession();
  const lineId = originLine?.lineId ?? null;
  return useMemo(() => {
    if (!sectionPick || !lineId) return null;
    return {
      lineId,
      first: sectionPick.first,
      onPick: (stationName: string) => {
        const next = stepSectionPick(sectionPick, stationName);
        setSectionPick(next.pick);
        if (next.section) addAnswer({ section: next.section });
      },
      onCancel: () => setSectionPick(null),
    };
  }, [sectionPick, lineId, setSectionPick, addAnswer]);
}
