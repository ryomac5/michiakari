"use client";

import type { Place, RouteOption, Section } from "@repo/schema";
import { Map as MapIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";

// 地図の枠。中身（MapLibre・deck.gl のレイヤー、出典表示）は WS6 が実装する
export type MapPanelProps = {
  origin: Place;
  destination: Place;
  options: RouteOption[];
  recommendedOptionId: string | null;
  // 止まっている区間。観測から分かったもの
  blockedSection: Section | null;
};

export function MapPanel(_props: MapPanelProps) {
  const t = useTranslations("map");

  return (
    <section
      data-testid={testIds.judgment.map}
      aria-label={t("title")}
      className="flex aspect-[4/3] max-h-[50dvh] w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border bg-surface-raised text-muted"
    >
      <MapIcon className="size-8" aria-hidden />
      <p className="font-bold">{t("placeholder")}</p>
    </section>
  );
}
