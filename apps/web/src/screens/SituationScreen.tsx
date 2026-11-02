"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TripSummary } from "@/features/judgment/components/TripSummary";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import { BackdropMap } from "@/features/map/BackdropMap";
import { selectMapLabels } from "@/features/map/labels";
import { SituationInput } from "@/features/situation/SituationInput";

// 状況の入力。地図の上に下から開いたシートとして出す
export function SituationScreen() {
  const t = useTranslations("situation");
  const attribution = selectMapLabels(useLocale()).attribution.short;
  const router = useRouter();
  const { origin, destination, catalog, state, submitInput } = useJudgmentSession();
  const places = useMemo(
    () => [origin, destination].filter((p) => p !== null),
    [origin, destination],
  );

  // 駅と行き先が未入力なら開始画面へ戻す
  useEffect(() => {
    if (origin === null || destination === null) router.replace("/");
  }, [origin, destination, router]);

  if (origin === null || destination === null) return null;

  return (
    <>
      <BackdropMap places={places} bottomInset={480} showAttribution={false} />
      <AppHeader variant="map">
        <TripSummary
          origin={origin}
          destination={destination}
          testId={testIds.situation.tripSummary}
        />
      </AppHeader>
      <main
        id="main"
        data-testid={testIds.situation.screen}
        className="relative z-10 flex min-h-dvh flex-col justify-end px-0 pt-[96px] sm:items-center sm:justify-center sm:px-4"
      >
        <section
          aria-labelledby="situation-title"
          className="glass-strong flex w-full animate-rise-in flex-col gap-4 rounded-t-[24px] px-4 pt-5 pb-[max(24px,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-[24px] sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h1
              id="situation-title"
              className="text-[22px] leading-tight font-bold tracking-tight text-balance"
            >
              {t("heading")}
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">{t("lead")}</p>
          </div>
          <SituationInput
            catalog={catalog}
            busy={state.status === "streaming"}
            onSubmit={(input) => {
              submitInput(input);
              router.push("/judgment");
            }}
          />
          <p className="truncate text-[10px] text-muted">{attribution}</p>
        </section>
      </main>
    </>
  );
}
