"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { ReplayPlayer } from "@/features/replay/components/ReplayPlayer";
import { ScenarioList } from "@/features/replay/components/ScenarioList";
import type { ReplayScenario } from "@/features/replay/scenario";

// リプレイの入口。シナリオを選ぶと再生画面に切り替わる
export function ReplayScreen({
  scenarios,
  initialScenarioId,
  initialSpeed,
}: {
  scenarios: ReplayScenario[];
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
        initialSpeed={initialSpeed}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <main
      data-testid={testIds.replay.screen}
      data-state="select"
      className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8"
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-extrabold">{t("heading")}</h1>
        <p className="text-lg leading-relaxed text-muted">{t("lead")}</p>
      </div>
      <ScenarioList scenarios={scenarios} catalog={catalog} onSelect={setSelectedId} />
      <p className="border-t border-border pt-4 text-sm text-muted">{t("fictional")}</p>
    </main>
  );
}
