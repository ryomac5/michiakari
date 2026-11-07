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
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type SituationTab, testIds } from "@/features/judgment/testids";
import {
  type CauseAnswer,
  type CauseCategoryId,
  causeChoiceIds,
  listCauseKinds,
  needsCauseKind,
  resolveCauseIncidentType,
  toCauseAnswer,
} from "./cause-categories";
import { type PhotoInput, preparePhoto } from "./prepare-photo";

type SituationInputProps = {
  busy: boolean;
  onSubmit: (input: RawInput) => void;
};

// 状況の入力。撮影する／貼り付ける／選んで答える の 3 通り
export function SituationInput({ busy, onSubmit }: SituationInputProps) {
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
        <SelectPanel busy={busy} onSubmit={onSubmit} />
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

export function PhotoPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
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
      <p className="text-[13px] text-muted">{t("hint")}</p>
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
          className="h-28 w-full flex-col border-dashed text-[14px] font-medium"
        >
          <Camera aria-hidden strokeWidth={1.5} className="size-7!" />
          {t("button")}
        </Button>
      )}
      {failed && (
        <p
          data-testid={testIds.situation.inputError}
          role="alert"
          className="text-[13px] text-danger"
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

export function PastePanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
  const t = useTranslations("situation.paste");
  const id = useId();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
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

// 選んで答える。入口と同じ原因の表から選び、選んだら判断する。雨・風などは種類を続けて選ぶ
// 送るのは事象の種類の id。種類が決まらない選択肢は並べない
export function SelectPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: RawInput) => void;
}) {
  const t = useTranslations("situation.select");
  const tEntry = useTranslations("entry");
  const [category, setCategory] = useState<CauseCategoryId | null>(null);

  function submitCause(answer: CauseAnswer) {
    const eventType = resolveCauseIncidentType(answer);
    if (eventType) onSubmit({ type: "selection", eventType, signalIds: [] });
  }

  if (category === null) {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("eventLabel")}</legend>
        {selectableChoiceIds.map((choice) => {
          const answer = toCauseAnswer(choice);
          return (
            <Button
              key={choice}
              variant="secondary"
              disabled={busy}
              data-testid={testIds.situation.causeOption(choice)}
              onClick={() =>
                answer.category && needsCauseKind(answer.category)
                  ? setCategory(answer.category)
                  : submitCause(answer)
              }
              className="justify-start"
            >
              {tEntry(`causes.${choice}`)}
            </Button>
          );
        })}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" onClick={() => setCategory(null)} className="self-start">
        <ChevronLeft aria-hidden />
        {t("back")}
      </Button>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("kindLabel")}</legend>
        {listCauseKinds(category)
          .filter((kind) => resolveCauseIncidentType({ category, kind }) !== null)
          .map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              disabled={busy}
              data-testid={testIds.situation.causeKindOption(kind)}
              onClick={() => submitCause({ category, kind })}
              className="justify-start"
            >
              {tEntry(`causeKinds.${kind}`)}
            </Button>
          ))}
      </fieldset>
    </div>
  );
}

// 種類が決まるか、種類を続けて聞く選択肢だけを並べる
const selectableChoiceIds = causeChoiceIds.filter((choice) => {
  const answer = toCauseAnswer(choice);
  if (answer.category && needsCauseKind(answer.category)) return true;
  return resolveCauseIncidentType(answer) !== null;
});
