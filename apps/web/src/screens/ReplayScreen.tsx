"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { BackdropMap } from "@/features/map/BackdropMap";
import { ReplayPlayer } from "@/features/replay/components/ReplayPlayer";
import { ScenarioList } from "@/features/replay/components/ScenarioList";
import type { ReplayScenario } from "@/features/replay/scenario";
import type { StationNames } from "@/features/stations/describe";

// リプレイの入口。シナリオを選ぶと再生画面に切り替わる
export function ReplayScreen({
  scenarios,
  stationNames,
  initialScenarioId,
  initialSpeed,
}: {
  scenarios: ReplayScenario[];
  stationNames: StationNames;
  initialScenarioId: string | null;
  initialSpeed: number;
}) {
  const t = useTranslations("replay");
  const { catalog } = useJudgmentSession();
  const [selectedId, setSelectedId] = useState<string | null>(initialScenarioId);
  const selected = scenarios.find((s) => s.id === selectedId) ?? null;

  if (selected) {
    return (
      <ReplayPlayer
        key={selected.id}
        scenario={selected}
        catalog={catalog}
        stationNames={stationNames}
        initialSpeed={initialSpeed}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <>
      <BackdropMap />
      <AppHeader />
      <main
        id="main"
        data-testid={testIds.replay.screen}
        data-state="select"
        className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[96px] pb-12"
      >
        <section className="glass-strong flex flex-col gap-4 rounded-[24px] p-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">{t("heading")}</h1>
            <p className="text-[14px] leading-relaxed text-muted">{t("lead")}</p>
          </div>
          <ScenarioList scenarios={scenarios} catalog={catalog} onSelect={setSelectedId} />
          <p className="text-[12px] text-muted">{t("fictional")}</p>
        </section>
      </main>
    </>
  );
}
