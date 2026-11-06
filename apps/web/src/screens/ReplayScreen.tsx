"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PageHero, PageShell } from "@/components/PageShell";
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
    <PageShell testId={testIds.replay.screen} state="select" wide>
      <PageHero icon={<Play />} title={t("heading")} lead={t("lead")} />
      <ScenarioList scenarios={scenarios} catalog={catalog} onSelect={setSelectedId} />
      <p className="px-2 text-center text-[12px] text-muted [text-shadow:0_0_4px_var(--background)]">
        {t("fictional")}
      </p>
    </PageShell>
  );
}
