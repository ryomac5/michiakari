import { ArrowLeft, BookOpen, Database, ExternalLink, ShieldAlert, Target } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LogoMark } from "@/components/LogoMark";
import { buttonVariants } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";

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
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col gap-3 rounded-[20px] bg-surface p-5 text-[15px] ring-1 ring-border"
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold [&>svg]:size-5 [&>svg]:stroke-[1.75] [&>svg]:text-muted">
        {icon}
        {title}
      </h2>
      {children}
    </section>
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
    <>
      <AppHeader />
      <main
        id="main"
        data-testid={testIds.about.screen}
        className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-[96px] pb-12"
      >
        <div className="flex items-center gap-4 py-2">
          <LogoMark className="size-14" />
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">{t("title")}</h1>
            <p className="text-[14px] text-muted">{t("subtitle")}</p>
          </div>
        </div>
        <p className="text-[15px] leading-relaxed text-muted">{t("intro")}</p>

        <AboutSection icon={<Target aria-hidden />} title={t("purpose.title")}>
          <p className="leading-relaxed">{t("purpose.p1")}</p>
          <p className="leading-relaxed">{t("purpose.p2")}</p>
        </AboutSection>

        <AboutSection icon={<BookOpen aria-hidden />} title={t("approach.title")}>
          <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
            <li>{t("approach.p1")}</li>
            <li>{t("approach.p2")}</li>
            <li>{t("approach.p3")}</li>
            <li>{t("approach.p4")}</li>
          </ul>
          <Link
            href="/knowledge"
            data-testid={testIds.about.knowledgeLink}
            className={buttonVariants({
              variant: "secondary",
              className: "h-auto min-h-12 self-start py-2 text-left whitespace-normal",
            })}
          >
            <BookOpen aria-hidden />
            {t("knowledgeLink")}
          </Link>
        </AboutSection>

        <AboutSection icon={<ShieldAlert aria-hidden />} title={t("notes.title")}>
          <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
            <li className="font-semibold">{t("notes.p1")}</li>
            <li>{t("notes.p2")}</li>
            <li>{t("notes.p3")}</li>
            <li>{t("notes.p4")}</li>
          </ul>
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

        <Link
          href="/"
          className={buttonVariants({ variant: "secondary", className: "self-start" })}
        >
          <ArrowLeft aria-hidden />
          {tApp("home")}
        </Link>
      </main>
    </>
  );
}
