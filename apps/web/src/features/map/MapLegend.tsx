"use client";

import type { Action } from "@repo/schema";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { useDocumentTheme } from "@/lib/use-document-theme";
import { selectMapLabels } from "./labels";
import { mapPalettes } from "./layers";
import type { ReachSource } from "./scene";
import { mapTestIds } from "./testids";

// 地図の見方。地図の上には常設せず、シートの中に小さく置く。線種の見本を添え、色だけに頼らない

function renderSample(children: ReactNode) {
  return (
    <svg viewBox="0 0 32 16" className="h-4 w-8 shrink-0" aria-hidden>
      {children}
    </svg>
  );
}

export function MapLegend({
  tone,
  reachSource,
}: {
  // 地図に描いている経路の色。一覧で選んだ選択肢か推奨の選択肢の種類に合わせ、地図と同じにする
  tone: Action;
  // 円で概算したときだけ「概算」を添える
  reachSource: ReachSource | null;
}) {
  const labels = selectMapLabels(useLocale());
  const palette = mapPalettes[useDocumentTheme()];
  const accent = palette.route[tone];

  const items: { id: string; sample: ReactNode; text: ReactNode }[] = [
    {
      id: "route",
      sample: renderSample(
        <>
          <line
            x1="3"
            y1="8"
            x2="29"
            y2="8"
            stroke={palette.routeCasing}
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="3"
            y1="8"
            x2="29"
            y2="8"
            stroke={accent}
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>,
      ),
      text: labels.legend.route,
    },
    {
      id: "blocked",
      sample: renderSample(
        <line
          x1="2"
          y1="8"
          x2="30"
          y2="8"
          stroke={palette.blocked}
          strokeWidth="4"
          strokeDasharray="6 4"
        />,
      ),
      text: labels.legend.blocked,
    },
    {
      id: "alternative",
      sample: renderSample(
        <line
          x1="2"
          y1="8"
          x2="30"
          y2="8"
          stroke={palette.alternative}
          strokeOpacity="0.6"
          strokeWidth="3"
          strokeLinecap="round"
        />,
      ),
      text: labels.legend.alternative,
    },
    {
      id: "reach",
      sample: renderSample(
        <>
          <rect x="3" y="2" width="26" height="12" rx="6" fill={palette.reach} fillOpacity="0.14" />
          <rect
            x="9"
            y="5"
            width="14"
            height="6"
            rx="3"
            fill="none"
            stroke={palette.reach}
            strokeDasharray="2 2"
          />
        </>,
      ),
      text: (
        <>
          {labels.legend.reach}
          {reachSource === "circle" && (
            <span
              data-testid={mapTestIds.reachApprox}
              className="ml-1 rounded border border-border px-1 text-[11px] text-muted"
            >
              {labels.legend.approx}
            </span>
          )}
        </>
      ),
    },
    {
      id: "places",
      sample: renderSample(
        <>
          <circle cx="9" cy="8" r="5" fill="currentColor" stroke="white" strokeWidth="2" />
          <path d="M23 15c-3-4-5-6-5-8.5a5 5 0 0 1 10 0c0 2.5-2 4.5-5 8.5Z" fill="currentColor" />
        </>,
      ),
      text: labels.legend.places,
    },
  ];

  return (
    <div data-testid={mapTestIds.legend} data-tone={tone} className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-muted">{labels.legend.title}</h3>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-1">
        {items.map((item) => (
          <li key={item.id} data-legend={item.id} className="flex items-center gap-2.5">
            {item.sample}
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
