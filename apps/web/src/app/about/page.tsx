import { ArrowLeft, BookOpen, Database, ExternalLink, ShieldAlert, Target } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
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
      className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 text-xl font-extrabold">
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
      className="flex min-h-11 items-center gap-1 font-bold underline underline-offset-4"
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
    <main
      id="main"
      data-testid={testIds.about.screen}
      className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-6 pb-10"
    >
      <div className="flex items-center gap-4">
        <LogoMark className="size-16" />
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl leading-tight font-extrabold">{t("title")}</h1>
          <p className="font-bold text-brand">{t("subtitle")}</p>
        </div>
      </div>
      <p className="leading-relaxed text-muted">{t("intro")}</p>

      <AboutSection icon={<Target className="size-6" aria-hidden />} title={t("purpose.title")}>
        <p className="leading-relaxed">{t("purpose.p1")}</p>
        <p className="leading-relaxed">{t("purpose.p2")}</p>
      </AboutSection>

      <AboutSection icon={<BookOpen className="size-6" aria-hidden />} title={t("approach.title")}>
        <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
          <li>{t("approach.p1")}</li>
          <li>{t("approach.p2")}</li>
          <li>{t("approach.p3")}</li>
          <li>{t("approach.p4")}</li>
        </ul>
      </AboutSection>

      <AboutSection icon={<ShieldAlert className="size-6" aria-hidden />} title={t("notes.title")}>
        <ul className="flex list-disc flex-col gap-2 pl-5 leading-relaxed">
          <li className="font-bold">{t("notes.p1")}</li>
          <li>{t("notes.p2")}</li>
          <li>{t("notes.p3")}</li>
          <li>{t("notes.p4")}</li>
        </ul>
      </AboutSection>

      <AboutSection
        icon={<Database className="size-6" aria-hidden />}
        title={t("attribution.title")}
        testId={testIds.about.attribution}
      >
        <ul className="flex flex-col gap-3 text-sm leading-relaxed">
          <li>{t("attribution.map")}</li>
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

      <Link href="/" className={buttonVariants({ variant: "outline", className: "self-start" })}>
        <ArrowLeft aria-hidden />
        {tApp("home")}
      </Link>
    </main>
  );
}
