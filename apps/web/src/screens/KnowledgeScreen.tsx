import type { Knowledge, KnowledgePhase, KnowledgeSignal, LocalizedText } from "@repo/schema";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CornerDownRight,
  FileCode,
  FlaskConical,
  MessageSquareQuote,
  Play,
  Radio,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EmptyState, PageHero, PageShell } from "@/components/PageShell";
import { testIds } from "@/features/judgment/testids";
import {
  buildEventAnchor,
  buildPhaseAnchor,
  buildSignalAnchor,
} from "@/features/knowledge/anchors";
import { pickLocalized } from "@/features/knowledge/catalog";
import type { KnowledgeDocument, YamlExcerpt } from "@/features/knowledge/document";
import { cn } from "@/lib/utils";

// 知見ナレッジの閲覧画面。PC 幅では左に YAML の該当部分、右に構造化した表示を並べる

export type KnowledgeScenarioLink = { id: string; title: LocalizedText; eventType: string };

const topAnchor = "knowledge-top";
// アンカーで飛んだ先を強調する
const targetHighlight =
  "scroll-mt-4 target:outline-4 target:outline-offset-4 target:outline-focus target:outline-solid";

export function KnowledgeScreen({
  documents,
  scenarios,
}: {
  documents: KnowledgeDocument[];
  scenarios: KnowledgeScenarioLink[];
}) {
  const t = useTranslations("knowledge");
  const anyDummy = documents.some((d) => d.dummy);

  return (
    <PageShell testId={testIds.knowledge.screen} wide>
      <div id={topAnchor} className="flex flex-col gap-4">
        <PageHero icon={<BookOpen />} title={t("title")} lead={t("lead")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <p
              data-testid={testIds.knowledge.notice}
              className="flex items-start gap-2 rounded-[16px] bg-foreground/[0.04] px-3.5 py-2.5 text-[13px] font-medium"
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              {t("notice")}
            </p>
            {anyDummy && (
              <p
                data-testid={testIds.knowledge.dummyNotice}
                className="flex items-start gap-2 rounded-[16px] bg-hold-surface px-3.5 py-2.5 text-[13px] font-medium text-hold"
              >
                <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("dummy")}
              </p>
            )}
          </div>
        </PageHero>

        {documents.length === 0 && <EmptyState icon={<BookOpen />} title={t("empty")} />}

        {documents.length > 1 && (
          <nav aria-labelledby="knowledge-contents" className="flex flex-col gap-2">
            <h2 id="knowledge-contents" className="sr-only">
              {t("overview")}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map(({ knowledge }) => (
                <li key={knowledge.id} className="flex">
                  <EventOverview knowledge={knowledge} />
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {documents.map((doc) => (
        <KnowledgeEvent
          key={doc.knowledge.id}
          document={doc}
          scenarios={scenarios.filter((s) => s.eventType === doc.knowledge.id)}
        />
      ))}
    </PageShell>
  );
}

// 事象の格子の 1 枚。名前・要約・段階の数と長さで、どんな知見かを見通せるようにする
function EventOverview({ knowledge }: { knowledge: Knowledge }) {
  const t = useTranslations("knowledge");
  const locale = useLocale();
  const total = knowledge.phases.reduce((sum, p) => sum + p.duration_minutes.p50, 0) || 1;
  return (
    <a
      href={`#${buildEventAnchor(knowledge.id)}`}
      className="glass-strong group flex w-full flex-col gap-3 rounded-[24px] p-5 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <span className="text-[18px] leading-tight font-bold">
        {pickLocalized(knowledge.name, locale)}
      </span>
      <span className="line-clamp-3 flex-1 text-[14px] leading-relaxed text-muted">
        {pickLocalized(knowledge.summary, locale)}
      </span>
      {/* 段階ごとの目安の長さを、濃淡を変えた帯で並べる */}
      <span aria-hidden className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {knowledge.phases.map((phase, i) => (
          <span
            key={phase.id}
            className="h-full rounded-full bg-foreground"
            style={{
              width: `${(phase.duration_minutes.p50 / total) * 100}%`,
              opacity: 0.85 - (i / Math.max(1, knowledge.phases.length)) * 0.6,
            }}
          />
        ))}
      </span>
      <span className="flex items-center justify-between text-[13px] font-semibold">
        <span className="text-muted">{t("phaseCount", { count: knowledge.phases.length })}</span>
        <span className="inline-flex items-center gap-1 transition-transform duration-150 group-hover:translate-x-0.5">
          {t("open")}
          <ArrowDown className="size-4" aria-hidden />
        </span>
      </span>
    </a>
  );
}

function KnowledgeEvent({
  document,
  scenarios,
}: {
  document: KnowledgeDocument;
  scenarios: KnowledgeScenarioLink[];
}) {
  const t = useTranslations("knowledge");
  const locale = useLocale();
  const { knowledge, excerpts, fileName } = document;

  return (
    <section
      id={buildEventAnchor(knowledge.id)}
      data-testid={testIds.knowledge.event(knowledge.id)}
      data-dummy={document.dummy}
      aria-labelledby={`${buildEventAnchor(knowledge.id)}-title`}
      className={cn("glass-strong flex flex-col gap-4 rounded-[28px] p-4 sm:p-6", targetHighlight)}
    >
      <Row yaml={excerpts.header} fileName={fileName} id={`${knowledge.id}-header`}>
        <div className="flex flex-col gap-3">
          <h2
            id={`${buildEventAnchor(knowledge.id)}-title`}
            className="text-[22px] leading-tight font-semibold"
          >
            {pickLocalized(knowledge.name, locale)}
          </h2>
          <p className="leading-relaxed">{pickLocalized(knowledge.summary, locale)}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <FileCode className="size-4 shrink-0" aria-hidden />
            {t("file", { file: `knowledge/${fileName}` })}
          </p>
          {scenarios.map((scenario) => (
            <Link
              key={scenario.id}
              href={`/replay?scenario=${scenario.id}`}
              data-testid={testIds.knowledge.replayLink(scenario.id)}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 py-2 font-medium hover:bg-surface-raised"
            >
              <Play className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                {t("replay", { title: pickLocalized(scenario.title, locale) })}
              </span>
            </Link>
          ))}
          <PhaseFlow knowledge={knowledge} />
        </div>
      </Row>

      {knowledge.phases.map((phase, i) => {
        const excerpt = excerpts.phases[phase.id];
        return (
          <Row
            key={phase.id}
            yaml={excerpt ?? null}
            fileName={fileName}
            id={`${knowledge.id}-${phase.id}`}
          >
            <PhaseCard knowledge={knowledge} phase={phase} index={i} />
          </Row>
        );
      })}

      <Row yaml={excerpts.rest} fileName={fileName} id={`${knowledge.id}-rest`}>
        <AfterResume knowledge={knowledge} />
      </Row>

      <a
        href={`#${topAnchor}`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl px-2 font-medium text-muted hover:bg-surface-raised"
      >
        <ArrowUp className="size-4" aria-hidden />
        {t("backToTop")}
      </a>
    </section>
  );
}

// 左に YAML、右に構造化した表示。狭い画面では YAML を折りたたんで下に置く
function Row({
  yaml,
  fileName,
  id,
  children,
}: {
  yaml: YamlExcerpt | null;
  fileName: string;
  id: string;
  children: ReactNode;
}) {
  const t = useTranslations("knowledge");

  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:gap-6">
      <div className="order-2 min-w-0 lg:order-1">
        {yaml && (
          <>
            <details className="group rounded-2xl border border-border bg-surface lg:hidden">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium text-muted">
                <FileCode className="size-4 shrink-0" aria-hidden />
                {t("yamlToggle")}
              </summary>
              <YamlBlock yaml={yaml} fileName={fileName} />
            </details>
            <div
              data-testid={testIds.knowledge.yaml(id)}
              className="hidden rounded-2xl border border-border bg-surface lg:sticky lg:top-24 lg:block"
            >
              <YamlBlock yaml={yaml} fileName={fileName} />
            </div>
          </>
        )}
      </div>
      <div className="order-1 min-w-0 lg:order-2">{children}</div>
    </div>
  );
}

function YamlBlock({ yaml, fileName }: { yaml: YamlExcerpt; fileName: string }) {
  const t = useTranslations("knowledge");

  return (
    <figure className="flex flex-col">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 border-b border-border px-4 py-2 text-xs font-medium text-muted">
        <span>{t("yaml")}</span>
        <span className="font-mono">
          {fileName}:{yaml.startLine}–{yaml.endLine}
        </span>
      </figcaption>
      <pre className="p-4 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{yaml.text}</code>
      </pre>
    </figure>
  );
}

// 段階の時系列。各段階の所要時間の目安を、p50 を濃く、p80 までを薄く描く
function PhaseFlow({ knowledge }: { knowledge: Knowledge }) {
  const t = useTranslations("knowledge");
  const locale = useLocale();
  const maxMinutes = Math.max(1, ...knowledge.phases.map((p) => p.duration_minutes.p80));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("phasesTitle")}</h3>
      <ol className="flex flex-col gap-1">
        {knowledge.phases.map((phase, i) => {
          const { p50, p80 } = phase.duration_minutes;
          return (
            <li key={phase.id}>
              <a
                href={`#${buildPhaseAnchor(knowledge.id, phase.id)}`}
                className="flex min-h-11 flex-col justify-center gap-1 rounded-xl px-2 py-1.5 hover:bg-surface-raised"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">
                    {i + 1}. {pickLocalized(phase.name, locale)}
                  </span>
                  <span className="text-sm text-muted tabular-nums">
                    {t("duration", { p50, p80 })}
                  </span>
                </span>
                <span className="relative h-2 w-full rounded-full bg-surface-raised" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-muted/40"
                    style={{ width: `${(p80 / maxMinutes) * 100}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                    style={{ width: `${(p50 / maxMinutes) * 100}%` }}
                  />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PhaseCard({
  knowledge,
  phase,
  index,
}: {
  knowledge: Knowledge;
  phase: KnowledgePhase;
  index: number;
}) {
  const t = useTranslations("knowledge");
  const locale = useLocale();
  const { p50, p80 } = phase.duration_minutes;

  return (
    <article
      id={buildPhaseAnchor(knowledge.id, phase.id)}
      data-testid={testIds.knowledge.phase(phase.id)}
      aria-labelledby={`${buildPhaseAnchor(knowledge.id, phase.id)}-title`}
      className={cn(
        "flex flex-col gap-4 rounded-[20px] border border-border bg-surface p-4 sm:p-5",
        targetHighlight,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted">
          {index + 1} / {knowledge.phases.length} · <code className="font-mono">{phase.id}</code>
        </p>
        <h3
          id={`${buildPhaseAnchor(knowledge.id, phase.id)}-title`}
          className="text-[18px] leading-tight font-semibold"
        >
          {pickLocalized(phase.name, locale)}
        </h3>
      </div>

      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="text-sm font-medium text-muted">{t("durationLabel")}</dt>
        <dd className="tabular-nums">
          <span className="font-medium">{t("duration", { p50, p80 })}</span>
          <span className="block text-sm text-muted">{t("durationDetail", { p50, p80 })}</span>
        </dd>
        <dt className="text-sm font-medium text-muted">{t("description")}</dt>
        <dd>{phase.description}</dd>
      </dl>

      <div className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 font-semibold">
          <Radio className="size-4 shrink-0" aria-hidden />
          {t("signals")}
        </h4>
        <ul className="flex flex-col gap-2">
          {phase.signals.map((signal) => (
            <SignalItem key={signal.id} signal={signal} />
          ))}
        </ul>
      </div>

      <ExitSignals knowledge={knowledge} phase={phase} />

      <div className="flex flex-col gap-1 rounded-2xl bg-surface-raised p-3">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="size-4 shrink-0" aria-hidden />
          {t("guidance")}
        </h4>
        <p>{pickLocalized(phase.guidance, locale)}</p>
      </div>
    </article>
  );
}

function SignalItem({ signal }: { signal: KnowledgeSignal }) {
  const t = useTranslations("knowledge");

  return (
    <li
      id={buildSignalAnchor(signal.id)}
      data-testid={testIds.knowledge.signal(signal.id)}
      className={cn("flex flex-col gap-2 rounded-2xl border border-border p-3", targetHighlight)}
    >
      <code className="font-mono text-sm font-medium break-all">{signal.id}</code>
      <p>{signal.description}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium text-muted">{t("observableFrom")}:</span>
        {signal.observable_from.map((kind) => (
          <span key={kind} className="rounded-md bg-surface-raised px-1.5 py-0.5">
            {t(`observable.${kind}`)}
          </span>
        ))}
      </div>
      {signal.example_phrases.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <MessageSquareQuote className="size-4 shrink-0" aria-hidden />
            {t("examples")}
          </p>
          <ul className="flex flex-col gap-1">
            {signal.example_phrases.map((phrase) => (
              <li key={phrase} className="border-l-2 border-border pl-2 text-sm">
                「{phrase}」
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

// exit_signals が指す兆候と、その兆候が属する段階
function ExitSignals({ knowledge, phase }: { knowledge: Knowledge; phase: KnowledgePhase }) {
  const t = useTranslations("knowledge");
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 font-semibold">
        <ArrowDown className="size-4 shrink-0" aria-hidden />
        {t("exitSignals")}
      </h4>
      {phase.exit_signals.length === 0 ? (
        <p className="text-muted">{t("noExit")}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{t("exitSignalsLead")}</p>
          <ul className="flex flex-col gap-1">
            {phase.exit_signals.map((id) => {
              const owner = knowledge.phases.find((p) => p.signals.some((s) => s.id === id));
              return (
                <li key={id}>
                  <a
                    href={`#${buildSignalAnchor(id)}`}
                    className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-raised"
                  >
                    <CornerDownRight className="size-4 shrink-0" aria-hidden />
                    <span className="flex min-w-0 flex-col">
                      <code className="font-mono text-sm font-medium break-all">{id}</code>
                      {owner && (
                        <span className="text-sm text-muted">
                          {t("exitInPhase", { phase: pickLocalized(owner.name, locale) })}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function AfterResume({ knowledge }: { knowledge: Knowledge }) {
  const t = useTranslations("knowledge");
  const { first_train_wait_minutes: wait, notes } = knowledge.after_resume;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-[20px] border border-border bg-surface p-4 sm:p-5">
        <h3 className="text-lg font-semibold">{t("afterResume")}</h3>
        <p className="font-medium tabular-nums">{t("firstTrainWait", wait)}</p>
        <p>{notes}</p>
      </section>
      <section
        data-testid={testIds.knowledge.caveats(knowledge.id)}
        className="flex flex-col gap-2 rounded-[20px] border border-switch-border bg-switch-surface p-4 sm:p-5"
      >
        <h3 className="flex items-center gap-2 text-lg font-semibold text-switch">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          {t("caveats")}
        </h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
          {knowledge.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2 rounded-[20px] border border-border bg-surface p-4 sm:p-5">
        <h3 className="text-lg font-semibold">{t("externalFactors")}</h3>
        <p>{knowledge.external_factors.notes}</p>
      </section>
    </div>
  );
}
