"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { TripSummary } from "@/features/judgment/components/TripSummary";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { SituationInput } from "@/features/situation/SituationInput";

export function SituationScreen() {
  const t = useTranslations("situation");
  const router = useRouter();
  const { origin, destination, catalog, state, submitInput } = useJudgmentSession();

  // 駅と行き先が未入力なら開始画面へ戻す
  useEffect(() => {
    if (origin === null || destination === null) router.replace("/");
  }, [origin, destination, router]);

  if (origin === null || destination === null) return null;

  return (
    <main
      id="main"
      data-testid={testIds.situation.screen}
      className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-2 pb-10"
    >
      <TripSummary
        origin={origin}
        destination={destination}
        testId={testIds.situation.tripSummary}
      />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-tight font-extrabold text-balance">{t("heading")}</h1>
        <p className="leading-relaxed text-muted">{t("lead")}</p>
      </div>
      <SituationInput
        catalog={catalog}
        busy={state.status === "streaming"}
        onSubmit={(input) => {
          submitInput(input);
          router.push("/judgment");
        }}
      />
    </main>
  );
}
