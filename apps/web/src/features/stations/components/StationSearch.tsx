"use client";

import { CircleAlert, LoaderCircle, Search } from "lucide-react";
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
  onSelect: (station: StationChoice) => void;
  onFreeText?: (text: string) => void;
  testIds: {
    search: string;
    option: (id: string) => string;
  };
  children?: ReactNode;
  // 見出しが別にあるときは、ラベルを読み上げ専用にする
  hideLabel?: boolean;
};

export function StationSearch({
  label,
  placeholder,
  onSelect,
  onFreeText,
  testIds,
  children,
  hideLabel = false,
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

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={cn("text-[12px] font-medium text-muted", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted"
          strokeWidth={1.75}
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
          className="pr-10 pl-10"
        />
        {status === "loading" && (
          <LoaderCircle
            className="absolute top-1/2 right-3 size-[18px] -translate-y-1/2 animate-spin text-muted"
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
          className="flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-border"
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
                "flex min-h-12 cursor-pointer flex-col justify-center gap-0.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-raised",
                i === activeIndex && "bg-surface-raised outline-2 -outline-offset-2 outline-focus",
              )}
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15px] font-semibold">
                  {pickStationName(station, locale)}
                </span>
                {locale === "en" && station.nameEn && (
                  <span lang="ja" className="text-[12px] text-muted">
                    {station.name}
                  </span>
                )}
              </span>
              <span className="truncate text-[12px] text-muted">
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
                "flex min-h-12 cursor-pointer items-center px-3 py-2 text-[15px] font-medium hover:bg-surface-raised",
                activeIndex === results.length &&
                  "bg-surface-raised outline-2 -outline-offset-2 outline-focus",
              )}
            >
              {t("useFreeText", { text: trimmed })}
            </div>
          )}
        </div>
      )}
      {trimmed !== "" && status === "ready" && results.length === 0 && !onFreeText && (
        <p className="px-3 py-2 text-[14px] text-muted">{t("noResults")}</p>
      )}
      {trimmed !== "" && status === "error" && (
        <p role="alert" className="flex items-center gap-2 px-3 py-2 text-[14px] text-danger">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {t("searchFailed")}
        </p>
      )}
    </div>
  );
}
