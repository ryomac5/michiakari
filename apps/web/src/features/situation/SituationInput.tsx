"use client";

import type { RawInput } from "@repo/schema";
import {
  Camera,
  Check,
  ChevronLeft,
  ClipboardPaste,
  ListChecks,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type SituationTab, testIds } from "@/features/judgment/testids";
import { type KnowledgeCatalog, pickLocalized } from "@/features/knowledge/catalog";
import { cn } from "@/lib/utils";
import { type PhotoInput, preparePhoto } from "./prepare-photo";

type SituationInputProps = {
  catalog: KnowledgeCatalog;
  busy: boolean;
  onSubmit: (input: RawInput) => void;
};

// 状況の入力。撮影する／貼り付ける／選んで答える の 3 通り
export function SituationInput({ catalog, busy, onSubmit }: SituationInputProps) {
  const t = useTranslations("situation");
  const [tab, setTab] = useState<SituationTab>("photo");

  return (
    <Tabs
      data-testid={testIds.situation.tabs}
      value={tab}
      onValueChange={(v) => setTab(v as SituationTab)}
    >
      <TabsList>
        <TabsTrigger value="photo" data-testid={testIds.situation.tab("photo")}>
          <Camera aria-hidden />
          {t("tabs.photo")}
        </TabsTrigger>
        <TabsTrigger value="paste" data-testid={testIds.situation.tab("paste")}>
          <ClipboardPaste aria-hidden />
          {t("tabs.paste")}
        </TabsTrigger>
        <TabsTrigger value="select" data-testid={testIds.situation.tab("select")}>
          <ListChecks aria-hidden />
          {t("tabs.select")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="photo">
        <PhotoPanel busy={busy} onSubmit={onSubmit} />
      </TabsContent>
      <TabsContent value="paste">
        <PastePanel busy={busy} onSubmit={onSubmit} />
      </TabsContent>
      <TabsContent value="select">
        <SelectPanel catalog={catalog} busy={busy} onSubmit={onSubmit} />
      </TabsContent>
    </Tabs>
  );
}

function SubmitButton({
  kind,
  busy,
  disabled,
  label,
  onClick,
}: {
  kind: SituationTab;
  busy: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const t = useTranslations("situation");
  return (
    <Button
      size="lg"
      data-testid={testIds.situation.submit(kind)}
      disabled={disabled || busy}
      onClick={onClick}
      className="w-full"
    >
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
      {busy ? t("busy") : label}
    </Button>
  );
}

function PhotoPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (input: RawInput) => void }) {
  const t = useTranslations("situation.photo");
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ input: PhotoInput; previewUrl: string } | null>(null);
  const [failed, setFailed] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFailed(false);
    const prepared = await preparePhoto(file).catch(() => null);
    if (prepared === null) setFailed(true);
    setPhoto(prepared);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{t("hint")}</p>
      <input
        ref={fileRef}
        data-testid={testIds.situation.photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {photo ? (
        <figure className="flex flex-col gap-2">
          {/* biome-ignore lint/performance/noImgElement: 端末内の data URL を表示するだけなので next/image は使わない */}
          <img
            data-testid={testIds.situation.photoPreview}
            src={photo.previewUrl}
            alt={t("preview")}
            className="max-h-72 w-full rounded-xl border border-border object-contain"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
            className="self-start"
          >
            <RotateCcw aria-hidden />
            {t("retake")}
          </Button>
        </figure>
      ) : (
        <Button
          variant="outline"
          size="lg"
          data-testid={testIds.situation.photoButton}
          onClick={() => fileRef.current?.click()}
          className="h-28 w-full flex-col border-dashed"
        >
          <Camera aria-hidden className="size-8!" />
          {t("button")}
        </Button>
      )}
      {failed && (
        <p
          data-testid={testIds.situation.inputError}
          role="alert"
          className="font-bold text-danger"
        >
          {t("unsupported")}
        </p>
      )}
      <SubmitButton
        kind="photo"
        busy={busy}
        disabled={photo === null}
        label={t("submit")}
        onClick={() => photo && onSubmit(photo.input)}
      />
    </div>
  );
}

function PastePanel({ busy, onSubmit }: { busy: boolean; onSubmit: (input: RawInput) => void }) {
  const t = useTranslations("situation.paste");
  const id = useId();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="font-bold">
        {t("label")}
      </label>
      <Textarea
        id={id}
        data-testid={testIds.situation.pasteInput}
        placeholder={t("placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <SubmitButton
        kind="paste"
        busy={busy}
        disabled={trimmed === ""}
        label={t("submit")}
        onClick={() => onSubmit({ type: "text", text: trimmed })}
      />
    </div>
  );
}

function SelectPanel({
  catalog,
  busy,
  onSubmit,
}: {
  catalog: KnowledgeCatalog;
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
  const t = useTranslations("situation.select");
  const locale = useLocale();
  const [eventType, setEventType] = useState<string | null>(null);
  const [signalIds, setSignalIds] = useState<string[]>([]);
  const selectedEvent = catalog.find((e) => e.id === eventType);

  if (catalog.length === 0) {
    return (
      <p data-testid={testIds.situation.selectionEmpty} className="text-muted">
        {t("empty")}
      </p>
    );
  }

  if (!selectedEvent) {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-bold">{t("eventLabel")}</legend>
        {catalog.map((event) => (
          <Button
            key={event.id}
            variant="outline"
            size="lg"
            data-testid={testIds.situation.eventTypeOption(event.id)}
            onClick={() => {
              setEventType(event.id);
              setSignalIds([]);
            }}
            className="justify-start"
          >
            {pickLocalized(event.name, locale)}
          </Button>
        ))}
      </fieldset>
    );
  }

  const signals = selectedEvent.phases.flatMap((p) => p.signals);
  function toggleSignal(id: string) {
    setSignalIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" onClick={() => setEventType(null)} className="self-start">
        <ChevronLeft aria-hidden />
        {t("back")}
      </Button>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-3 font-bold">
          {pickLocalized(selectedEvent.name, locale)} — {t("signalLabel")}
        </legend>
        {signals.map((signal) => {
          const checked = signalIds.includes(signal.id);
          return (
            <label
              key={signal.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 has-focus-visible:outline-3 has-focus-visible:outline-focus",
                checked ? "border-foreground bg-surface-raised" : "border-border bg-surface",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                data-testid={testIds.situation.signalOption(signal.id)}
                onChange={() => toggleSignal(signal.id)}
              />
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2",
                  checked ? "border-foreground bg-foreground text-background" : "border-muted",
                )}
                aria-hidden
              >
                {checked && <Check className="size-4" />}
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-bold">{signal.description}</span>
                {signal.example_phrases[0] && (
                  <span className="text-sm text-muted">「{signal.example_phrases[0]}」</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <SubmitButton
        kind="select"
        busy={busy}
        disabled={false}
        label={t("submit")}
        onClick={() => onSubmit({ type: "selection", eventType: selectedEvent.id, signalIds })}
      />
    </div>
  );
}
