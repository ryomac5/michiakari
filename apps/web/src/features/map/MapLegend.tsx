import type { ReactNode } from "react";
import type { MapLabels } from "./labels";
import type { MapPalette } from "./layers";
import { mapTestIds } from "./testids";

// 凡例。地図と同じ線種のサンプルを添え、色だけに頼らない

function renderSample(children: ReactNode) {
  return (
    <svg viewBox="0 0 40 16" className="h-4 w-10 shrink-0" aria-hidden>
      {children}
    </svg>
  );
}

export function MapLegend({ palette, labels }: { palette: MapPalette; labels: MapLabels }) {
  const items: { id: string; sample: ReactNode; text: ReactNode }[] = [
    {
      id: "blocked",
      sample: renderSample(
        <>
          <line x1="2" y1="8" x2="38" y2="8" stroke={palette.blockedCasing} strokeWidth="8" />
          <line
            x1="2"
            y1="8"
            x2="38"
            y2="8"
            stroke={palette.blocked}
            strokeWidth="5"
            strokeDasharray="8 5"
          />
        </>,
      ),
      text: labels.legend.blocked,
    },
    {
      id: "route",
      sample: renderSample(
        <>
          <line x1="2" y1="8" x2="22" y2="8" stroke={palette.routeCasing} strokeWidth="8" />
          <line x1="2" y1="8" x2="22" y2="8" stroke={palette.route} strokeWidth="4.5" />
          <line
            x1="28"
            y1="8"
            x2="38"
            y2="8"
            stroke={palette.route}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray="0 7"
          />
        </>,
      ),
      text: labels.legend.route,
    },
    {
      id: "transfer",
      sample: renderSample(
        <>
          <line
            x1="4"
            y1="8"
            x2="36"
            y2="8"
            stroke={palette.transfer}
            strokeOpacity="0.55"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <line x1="4" y1="8" x2="36" y2="8" stroke="#8b2332" strokeWidth="3" />
        </>,
      ),
      text: labels.legend.transfer,
    },
    {
      id: "reach",
      sample: renderSample(
        <>
          <circle
            cx="20"
            cy="8"
            r="7.5"
            fill={palette.reach}
            fillOpacity="0.12"
            stroke={palette.reach}
            strokeDasharray="2 2"
          />
          <circle cx="20" cy="8" r="4" fill={palette.reach} fillOpacity="0.3" />
        </>,
      ),
      text: (
        <>
          {labels.legend.reach}
          <span className="ml-1 rounded border border-border px-1 text-xs font-bold text-muted">
            {labels.legend.approx}
          </span>
        </>
      ),
    },
    {
      id: "reachable",
      sample: renderSample(
        <circle
          cx="20"
          cy="8"
          r="5"
          fill="#e5171f"
          stroke={palette.emphasisStroke}
          strokeWidth="2.5"
        />,
      ),
      text: labels.legend.reachable,
    },
  ];

  return (
    <div data-testid={mapTestIds.legend} className="px-1">
      <h3 className="sr-only">{labels.legend.title}</h3>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} data-legend={item.id} className="flex items-center gap-2">
            {item.sample}
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
