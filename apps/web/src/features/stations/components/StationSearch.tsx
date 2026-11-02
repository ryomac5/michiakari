"use client";

import { MapPin, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Station } from "../fixtures/stations";
import { pickStationName, searchStations } from "../search";

type StationSearchProps = {
  label: string;
  placeholder: string;
  stations: Station[];
  // 選択済みのときの表示名。null なら検索欄を出す
  selectedLabel: string | null;
  selectedDetail?: ReactNode;
  onSelect: (station: Station) => void;
  onFreeText?: (text: string) => void;
  onClear: () => void;
  testIds: {
    search: string;
    option: (id: string) => string;
    selected: string;
    clear: string;
  };
  children?: ReactNode;
};

export function StationSearch({
  label,
  placeholder,
  stations,
  selectedLabel,
  selectedDetail,
  onSelect,
  onFreeText,
  onClear,
  testIds,
  children,
}: StationSearchProps) {
  const t = useTranslations("start");
  const locale = useLocale();
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const results = searchStations(stations, query);
  const trimmed = query.trim();

  if (selectedLabel !== null) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-muted">{label}</span>
        <div
          data-testid={testIds.selected}
          className="flex items-center gap-3 rounded-xl border-2 border-foreground bg-surface px-4 py-3"
        >
          <MapPin className="size-6 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-extrabold">{selectedLabel}</p>
            {selectedDetail && <p className="text-sm text-muted">{selectedDetail}</p>}
          </div>
          <button
            type="button"
            data-testid={testIds.clear}
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold text-muted hover:bg-surface-raised"
          >
            <X className="size-4" aria-hidden />
            {t("clear")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-bold text-muted">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          id={inputId}
          data-testid={testIds.search}
          role="combobox"
          aria-expanded={trimmed !== ""}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-12"
        />
      </div>
      {children}
      {trimmed !== "" && (
        <ul id={listId} aria-label={label} className="flex flex-col gap-1">
          {results.map((station) => (
            <li key={station.id}>
              <button
                type="button"
                data-testid={testIds.option(station.id)}
                onClick={() => onSelect(station)}
                className="flex w-full items-baseline gap-3 rounded-xl bg-surface px-4 py-3 text-left hover:bg-surface-raised"
              >
                <span className="text-lg font-bold">{pickStationName(station, locale)}</span>
                <span className="truncate text-sm text-muted">{station.lines.join("・")}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && !onFreeText && (
            <li className="px-4 py-2 text-muted">{t("noResults")}</li>
          )}
          {onFreeText && !results.some((s) => s.name === trimmed) && (
            <li>
              <button
                type="button"
                data-testid={testIds.option("free_text")}
                onClick={() => onFreeText(trimmed)}
                className="w-full rounded-xl border-2 border-dashed border-border px-4 py-3 text-left font-bold hover:bg-surface-raised"
              >
                {t("useFreeText", { text: trimmed })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
