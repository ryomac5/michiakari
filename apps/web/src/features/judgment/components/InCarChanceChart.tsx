"use client";

import type { InCarChance, ResumeChance } from "@repo/schema";
import { useTranslations } from "next-intl";
import { useNow } from "../use-now";
import { ResumeChanceChart } from "./ResumeChanceChart";

// 電車の中の人の、動き出している見込みの図。駅にいる人の図と同じ部品に、次の駅に着く時刻の印を付けて渡す
// 値は判断の結果のものをそのまま使い、画面では計算しない

function toResumeChance(chance: InCarChance): ResumeChance {
  return {
    stepMinutes: chance.stepMinutes,
    ticks: chance.ticks,
    waitFaster: null,
    waitOnTime: null,
    resumeByForDeadline: null,
    onsetTime: chance.onsetTime,
  };
}

export function InCarChanceChart({
  chance,
  showOnset,
}: {
  chance: InCarChance;
  showOnset: boolean;
}) {
  const t = useTranslations("judgment.resumeChance");
  const now = useNow();
  return (
    <div data-sheet-half-end="" className="flex flex-col gap-1">
      <ResumeChanceChart
        chance={toResumeChance(chance)}
        breakEvenTime={null}
        now={now}
        showOnset={showOnset}
        relation={null}
        title={t("inCarTitle")}
        arrival={chance.mark}
      />
    </div>
  );
}
