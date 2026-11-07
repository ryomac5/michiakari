"use client";

import type { RawInput } from "@repo/schema";
import {
  Camera,
  Check,
  ChevronLeft,
  ClipboardPaste,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJudgmentSession } from "@/features/judgment/session";
import { type SituationTab, testIds } from "@/features/judgment/testids";
import { formatClockTime } from "@/features/judgment/time";
import {
  type AddableItemId,
  buildCueInput,
  type KnownCause,
  listAddableItems,
  listAnsweredItems,
  resolveKnownCause,
  selectAddInfoChoices,
} from "./add-info";
import type { AddedAnswers } from "./added-answers";
import {
  type CauseAnswer,
  type CauseCategoryId,
  causeChoiceIds,
  listCauseKinds,
  needsCauseKind,
  toCauseAnswer,
} from "./cause-categories";
import { elapsedOptions, listResumeTimeOptions } from "./plain-questions";
import { type PhotoInput, preparePhoto } from "./prepare-photo";
import { protectionAnswerIds } from "./protection-broadcast";
import { ticketAnswerIds } from "./ticket";

type SituationInputProps = {
  busy: boolean;
  onSubmit: (input: RawInput) => void;
  // 答えを足したか、地図で区間を選び始めたとき。シートを閉じて地図と判断を見せる
  onAnswered: () => void;
};

// 判断の画面の状況の入力。選んで答える／撮影する／貼り付ける の 3 通り
export function SituationInput({ busy, onSubmit, onAnswered }: SituationInputProps) {
  const t = useTranslations("situation");
  const [tab, setTab] = useState<SituationTab>("select");

  return (
    <Tabs
      data-testid={testIds.situation.tabs}
      value={tab}
      onValueChange={(v) => setTab(v as SituationTab)}
    >
      <TabsList>
        <TabsTrigger value="select" data-testid={testIds.situation.tab("select")}>
          <ListChecks aria-hidden />
          {t("tabs.select")}
        </TabsTrigger>
        <TabsTrigger value="photo" data-testid={testIds.situation.tab("photo")}>
          <Camera aria-hidden />
          {t("tabs.photo")}
        </TabsTrigger>
        <TabsTrigger value="paste" data-testid={testIds.situation.tab("paste")}>
          <ClipboardPaste aria-hidden />
          {t("tabs.paste")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="select">
        <SelectPanel busy={busy} onAnswered={onAnswered} />
      </TabsContent>
      <TabsContent value="photo">
        <PhotoPanel busy={busy} onSubmit={onSubmit} />
      </TabsContent>
      <TabsContent value="paste">
        <PastePanel busy={busy} onSubmit={onSubmit} />
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

// 選んで答える。原因が決まっていれば原因の札と放送の手がかりを先に出し、決まっていなければ原因を先に聞く
// 止まってからの分や再開見込みなどは、分かったときに札から 1 つずつ足す。足した答えは札に残し、押せば選び直す
export function SelectPanel({ busy, onAnswered }: { busy: boolean; onAnswered: () => void }) {
  const t = useTranslations("situation.select");
  const session = useJudgmentSession();
  const { addedAnswers, addAnswer, tripContext, originLine, state, setSectionPick } = session;
  const [open, setOpen] = useState<Exclude<OpenItem, "section"> | null>(null);
  const observations = [...session.observations, ...state.observations];
  const known = resolveKnownCause({ answeredCause: addedAnswers.cause, observations });
  const onTrain = tripContext?.onTrain ?? false;
  const choices = selectAddInfoChoices(known, onTrain);
  const addable = listAddableItems({
    answers: addedAnswers,
    onTrain,
    hasLine: originLine !== null,
  });

  function answer(patch: Partial<AddedAnswers>) {
    setOpen(null);
    addAnswer(patch);
    onAnswered();
  }

  function openItem(item: OpenItem) {
    if (item !== "section") {
      setOpen(item);
      return;
    }
    setSectionPick({ first: null });
    onAnswered();
  }

  if (open === "cause") {
    return (
      <PickerFrame onBack={known ? () => setOpen(null) : undefined}>
        <CauseChoices busy={busy} onSelect={(cause) => answer({ cause })} />
      </PickerFrame>
    );
  }
  if (open !== null) {
    return (
      <PickerFrame onBack={() => setOpen(null)}>
        <ItemChoices item={open} busy={busy} onSelect={answer} />
      </PickerFrame>
    );
  }

  function submitCue(input: RawInput) {
    session.submitInput(input);
    onAnswered();
  }

  return (
    <div className="flex flex-col gap-5">
      <AnsweredChips
        known={choices.kind === "cues" ? choices.cause : null}
        answers={addedAnswers}
        disabled={busy}
        onEdit={openItem}
      />
      {choices.kind === "cause" ? (
        <CauseChoices busy={busy} onSelect={(cause) => answer({ cause })} />
      ) : (
        <ChipGroup label={t("cuesLabel")}>
          {choices.cues.map((cue) => (
            <ChoiceChip
              key={cue}
              testId={testIds.situation.cue(cue)}
              disabled={busy}
              onClick={() => submitCue(buildCueInput(choices.cause, cue))}
            >
              {t(`cues.${cue}`)}
            </ChoiceChip>
          ))}
        </ChipGroup>
      )}
      {addable.length > 0 && (
        <ChipGroup label={t("itemsLabel")}>
          {addable.map((item) => (
            <ChoiceChip
              key={item}
              testId={testIds.situation.item(item)}
              disabled={busy}
              onClick={() => openItem(item)}
            >
              <Plus aria-hidden className="size-4" />
              {t(`items.${item}`)}
            </ChoiceChip>
          ))}
        </ChipGroup>
      )}
    </div>
  );
}

type OpenItem = "cause" | AddableItemId;

function PickerFrame({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  const t = useTranslations("situation.select");
  return (
    <div className="flex flex-col gap-3">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          data-testid={testIds.situation.back}
          onClick={onBack}
          className="self-start"
        >
          <ChevronLeft aria-hidden />
          {t("back")}
        </Button>
      )}
      {children}
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[13px] font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function ChoiceChip({
  testId,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-4 text-[14px] font-semibold transition-[transform,background-color] duration-150 hover:bg-foreground/10 active:scale-[0.97] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// 足した答えの札。原因は決まっている原因を出す。押せばその項目を選び直す
function AnsweredChips({
  known,
  answers,
  disabled,
  onEdit,
}: {
  known: KnownCause | null;
  answers: AddedAnswers;
  disabled: boolean;
  onEdit: (item: OpenItem) => void;
}) {
  const t = useTranslations("situation.select");
  const tEntry = useTranslations("entry");
  const locale = useLocale();
  const answered = listAnsweredItems(answers);
  if (!known && answered.length === 0) return null;

  function describe(item: AddableItemId): string {
    switch (item) {
      case "elapsed":
        return answers.elapsed ? tEntry(`elapsed.${answers.elapsed}`) : "";
      case "protection":
        return answers.protection ? tEntry(`protection.${answers.protection}`) : "";
      case "resume":
        return answers.resume?.iso
          ? formatClockTime(answers.resume.iso, locale)
          : answers.resume
            ? t(`resume.${answers.resume.id}`)
            : "";
      case "ticket":
        return answers.ticket ? tEntry(`ticket.${answers.ticket}`) : "";
      case "section":
        return answers.section
          ? `${answers.section.fromStation}〜${answers.section.toStation}`
          : "";
    }
  }

  return (
    <div className="flex flex-wrap gap-x-1.5">
      {known && (
        <EditChip
          testId={testIds.situation.answer("cause")}
          label={
            known.label.scope === "causes"
              ? tEntry(`causes.${known.label.id}`)
              : tEntry(`causeKinds.${known.label.id}`)
          }
          aria={t("items.cause")}
          disabled={disabled}
          onClick={() => onEdit("cause")}
        />
      )}
      {answered.map((item) => (
        <EditChip
          key={item}
          testId={testIds.situation.answer(item)}
          label={`${t(`items.${item}`)} ${describe(item)}`}
          aria={t(`items.${item}`)}
          disabled={disabled}
          onClick={() => onEdit(item)}
        />
      ))}
    </div>
  );
}

// 鉛筆の印を添えた小さな札。押せる高さは 44px のまま、見える札は低くする
function EditChip({
  testId,
  label,
  aria,
  disabled,
  onClick,
}: {
  testId: string;
  label: string;
  aria: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("situation.select");
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${aria} ${label}・${t("change")}`}
      className="group -my-1.5 inline-flex h-11 max-w-full min-w-0 items-center disabled:opacity-50"
    >
      <span className="inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-full bg-focus/[0.10] px-2.5 text-[12px] leading-none font-semibold text-focus transition-[transform,background-color] duration-150 group-hover:bg-focus/[0.16] group-active:scale-[0.97]">
        <span className="truncate">{label}</span>
        <Pencil className="size-3 shrink-0 opacity-70" strokeWidth={2.25} aria-hidden />
      </span>
    </button>
  );
}

// 原因の選択肢。雨・風などは種類を続けて選ぶ。種類の決まらない大分類は統計値の見込みに使う
function CauseChoices({
  busy,
  onSelect,
}: {
  busy: boolean;
  onSelect: (answer: CauseAnswer) => void;
}) {
  const t = useTranslations("situation.select");
  const tEntry = useTranslations("entry");
  const [category, setCategory] = useState<CauseCategoryId | null>(null);

  if (category === null) {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("eventLabel")}</legend>
        {causeChoiceIds.map((choice) => {
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
                  : onSelect(answer)
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
        {t("backToCause")}
      </Button>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("kindLabel")}</legend>
        {listCauseKinds(category).map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            disabled={busy}
            data-testid={testIds.situation.causeKindOption(kind)}
            onClick={() => onSelect({ category, kind })}
            className="justify-start"
          >
            {tEntry(`causeKinds.${kind}`)}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}

// 項目ごとの選択肢。押せばその答えを足す。区間は地図で選ぶのでここには来ない
function ItemChoices({
  item,
  busy,
  onSelect,
}: {
  item: Exclude<AddableItemId, "section">;
  busy: boolean;
  onSelect: (patch: Partial<AddedAnswers>) => void;
}) {
  const t = useTranslations("situation.select");
  const tEntry = useTranslations("entry");
  const locale = useLocale();
  const [now] = useState(() => new Date());

  if (item === "resume") {
    return (
      <div className="flex flex-col gap-4">
        <ChipGroup label={t("questions.resumeTime")}>
          {listResumeTimeOptions(now).map((time) => (
            <ChoiceChip
              key={time.id}
              testId={testIds.situation.option("resume-time", time.id)}
              disabled={busy}
              onClick={() => onSelect({ resume: { id: "stated", iso: time.iso } })}
            >
              <span className="tabular-nums">{formatClockTime(time.iso, locale)}</span>
            </ChoiceChip>
          ))}
        </ChipGroup>
        <ChipGroup label={t("questions.resume")}>
          {(["undecided", "unknown"] as const).map((id) => (
            <ChoiceChip
              key={id}
              testId={testIds.situation.option("resume", id)}
              disabled={busy}
              onClick={() => onSelect({ resume: { id, iso: null } })}
            >
              {t(`resume.${id}`)}
            </ChoiceChip>
          ))}
        </ChipGroup>
      </div>
    );
  }

  const options: { id: string; label: string; patch: Partial<AddedAnswers> }[] =
    item === "elapsed"
      ? elapsedOptions.map((o) => ({
          id: o.id,
          label: tEntry(`elapsed.${o.id}`),
          patch: { elapsed: o.id },
        }))
      : item === "protection"
        ? protectionAnswerIds.map((id) => ({
            id,
            label: tEntry(`protection.${id}`),
            patch: { protection: id },
          }))
        : ticketAnswerIds.map((id) => ({
            id,
            label: tEntry(`ticket.${id}`),
            patch: { ticket: id },
          }));
  return (
    <ChipGroup label={t(`questions.${item}`)}>
      {options.map((option) => (
        <ChoiceChip
          key={option.id}
          testId={testIds.situation.option(item, option.id)}
          disabled={busy}
          onClick={() => onSelect(option.patch)}
        >
          {option.label}
        </ChoiceChip>
      ))}
    </ChipGroup>
  );
}
