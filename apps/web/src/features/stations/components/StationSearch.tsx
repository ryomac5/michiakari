"use client";

import { CircleAlert, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StationChoice } from "../catalog";
import { describeStationLines, pickStationName } from "../describe";
import { useStationSearch } from "../use-station-search";

type StationSearchProps = {
  label: string;
  placeholder: string;
  // 選択済みのときの表示名。null なら検索欄を出す
  selectedLabel: string | null;
  selectedDetail?: ReactNode;
  onSelect: (station: StationChoice) => void;
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
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const { status, results } = useStationSearch(query);
  const trimmed = query.trim();
  const showFreeText =
    onFreeText !== undefined && status === "ready" && !results.some((s) => s.name === trimmed);
  const optionCount = results.length + (showFreeText ? 1 : 0);
  const expanded = trimmed !== "" && optionCount > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  function choose(index: number) {
    const station = results[index];
    if (station) onSelect(station);
    else if (showFreeText) onFreeText?.(trimmed);
  }

  // 上下キーで候補を移り、Enter で決める
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && optionCount > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % optionCount);
    } else if (e.key === "ArrowUp" && optionCount > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? optionCount - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === "Escape") {
      setQuery("");
      setActiveIndex(-1);
    }
  }

  if (selectedLabel !== null) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-muted">{label}</span>
        <div
          data-testid={testIds.selected}
          className="flex items-center gap-3 rounded-2xl border-2 border-foreground/80 bg-surface py-2 pr-2 pl-4"
        >
          <MapPin className="size-6 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xl leading-tight font-extrabold break-words">{selectedLabel}</p>
            {selectedDetail && <p className="text-sm text-muted">{selectedDetail}</p>}
          </div>
          <button
            type="button"
            data-testid={testIds.clear}
            aria-label={`${label}: ${t("clear")}`}
            onClick={() => {
              setQuery("");
              setActiveIndex(-1);
              onClear();
            }}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-bold text-muted hover:bg-surface-raised"
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
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          className="pr-12 pl-12"
        />
        {status === "loading" && (
          <LoaderCircle
            className="absolute top-1/2 right-4 size-5 -translate-y-1/2 animate-spin text-muted"
            aria-hidden
          />
        )}
      </div>
      {children}
      <p id={statusId} role="status" className="sr-only">
        {status === "ready" && trimmed !== "" ? t("resultCount", { count: results.length }) : ""}
      </p>
      {trimmed !== "" && (results.length > 0 || showFreeText) && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          aria-busy={status === "loading"}
          className="flex flex-col gap-1.5"
        >
          {results.map((station, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: キー操作は combobox の入力欄が受け持つ
            <div
              key={station.id}
              id={optionId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === activeIndex}
              data-testid={testIds.option(station.id)}
              onClick={() => onSelect(station)}
              className={cn(
                "flex min-h-14 cursor-pointer flex-col justify-center gap-0.5 rounded-xl border-2 border-transparent bg-surface px-4 py-2 hover:bg-surface-raised",
                i === activeIndex && "border-focus bg-surface-raised",
              )}
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-bold">{pickStationName(station, locale)}</span>
                {locale === "en" && station.nameEn && (
                  <span lang="ja" className="text-sm text-muted">
                    {station.name}
                  </span>
                )}
              </span>
              <span className="truncate text-sm text-muted">
                {describeStationLines(station, locale)}
              </span>
            </div>
          ))}
          {showFreeText && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: キー操作は combobox の入力欄が受け持つ
            <div
              id={optionId(results.length)}
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === results.length}
              data-testid={testIds.option("free_text")}
              onClick={() => onFreeText?.(trimmed)}
              className={cn(
                "flex min-h-14 cursor-pointer items-center rounded-xl border-2 border-dashed border-border px-4 py-2 font-bold hover:bg-surface-raised",
                activeIndex === results.length && "border-focus",
              )}
            >
              {t("useFreeText", { text: trimmed })}
            </div>
          )}
        </div>
      )}
      {trimmed !== "" && status === "ready" && results.length === 0 && !onFreeText && (
        <p className="px-4 py-2 text-muted">{t("noResults")}</p>
      )}
      {trimmed !== "" && status === "error" && (
        <p role="alert" className="flex items-center gap-2 px-4 py-2 font-bold text-danger">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {t("searchFailed")}
        </p>
      )}
    </div>
  );
}
