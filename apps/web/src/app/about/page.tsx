import {
  BookOpen,
  Database,
  ExternalLink,
  Lightbulb,
  Map as MapIcon,
  ShieldAlert,
  Target,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/LogoMark";
import { PageCard, PageHero, PageShell } from "@/components/PageShell";
import { buttonVariants } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";

// 国土数値情報のデータページ（data-sources.md 4 章）
const railDataUrl = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html";
const ridershipDataUrl = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-S12-2024.html";

export async function generateMetadata() {
  const t = await getTranslations("about");
  return { title: t("title") };
}

function AboutSection({
  icon,
  title,
  children,
  testId,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <PageCard testId={testId} className={cn("text-[15px]", className)}>
      <h2 className="flex items-center gap-2.5 text-[17px] font-bold">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-foreground/[0.06] text-muted [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
        >
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </PageCard>
  );
}

function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-11 items-center gap-1 text-[13px] font-medium text-focus underline underline-offset-4"
    >
      <span className="min-w-0 break-all">{children}</span>
      <ExternalLink className="size-4 shrink-0" aria-hidden />
    </a>
  );
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const tApp = await getTranslations("app");

  return (
    <PageShell testId={testIds.about.screen}>
      <PageHero icon={<LogoMark className="size-11" />} title={t("title")} lead={t("intro")}>
        <Link
          href="/"
          className={buttonVariants({
            variant: "secondary",
            size: "sm",
            className: "self-start rounded-full px-4",
          })}
        >
          <MapIcon aria-hidden />
          {tApp("home")}
        </Link>
      </PageHero>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AboutSection
          icon={<Lightbulb aria-hidden />}
          title={t("why.title")}
          testId={testIds.about.why}
          className="lg:col-span-2"
        >
          <p className="leading-relaxed">{t("why.p1")}</p>
          <p className="leading-relaxed">{t("why.p2")}</p>
        </AboutSection>
        <AboutSection icon={<Target aria-hidden />} title={t("purpose.title")}>
          <p className="leading-relaxed">{t("purpose.p1")}</p>
          <p className="leading-relaxed">{t("purpose.p2")}</p>
        </AboutSection>

        <AboutSection icon={<ShieldAlert aria-hidden />} title={t("notes.title")}>
          <ul className="flex flex-col gap-2.5 leading-relaxed">
            <Bullet strong>{t("notes.p1")}</Bullet>
            <Bullet>{t("notes.p2")}</Bullet>
            <Bullet>{t("notes.p3")}</Bullet>
            <Bullet>{t("notes.p4")}</Bullet>
          </ul>
        </AboutSection>

        <AboutSection icon={<BookOpen aria-hidden />} title={t("approach.title")}>
          <ul className="flex flex-col gap-2.5 leading-relaxed">
            <Bullet>{t("approach.p1")}</Bullet>
            <Bullet>{t("approach.p2")}</Bullet>
            <Bullet>{t("approach.p3")}</Bullet>
            <Bullet>{t("approach.p4")}</Bullet>
          </ul>
          <Link
            href="/knowledge"
            data-testid={testIds.about.knowledgeLink}
            className={buttonVariants({
              variant: "secondary",
              className: "h-auto min-h-12 self-start rounded-full py-2 text-left whitespace-normal",
            })}
          >
            <BookOpen aria-hidden />
            {t("knowledgeLink")}
          </Link>
        </AboutSection>

        <AboutSection
          icon={<Database aria-hidden />}
          title={t("attribution.title")}
          testId={testIds.about.attribution}
        >
          <ul className="flex flex-col gap-3 text-[13px] leading-relaxed">
            <li>{t("attribution.map")}</li>
            <li>{t("attribution.walk")}</li>
            <li className="flex flex-col">
              <span>{t("attribution.rail")}</span>
              <SourceLink href={railDataUrl}>{railDataUrl}</SourceLink>
            </li>
            <li className="flex flex-col">
              <span>{t("attribution.ridership")}</span>
              <SourceLink href={ridershipDataUrl}>{ridershipDataUrl}</SourceLink>
            </li>
            <li>{t("attribution.weather")}</li>
          </ul>
        </AboutSection>
      </div>
    </PageShell>
  );
}

// 箇条の行頭は小さな丸。強調する行は文字を太くする
function Bullet({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <li className={cn("flex gap-2.5", strong && "font-semibold")}>
      <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand" />
      <span>{children}</span>
    </li>
  );
}
