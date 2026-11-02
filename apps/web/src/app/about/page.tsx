import { BookOpen, Database, ShieldAlert, Target } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { testIds } from "@/features/judgment/testids";

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

export default async function AboutPage() {
  const t = await getTranslations("about");
  const tApp = await getTranslations("app");

  return (
    <main
      data-testid={testIds.about.screen}
      className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6"
    >
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>

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

      <AboutSection
        icon={<Database className="size-6" aria-hidden />}
        title={t("attribution.title")}
        testId={testIds.about.attribution}
      >
        <ul className="flex flex-col gap-1 leading-relaxed">
          <li>{t("attribution.map")}</li>
          <li>{t("attribution.rail")}</li>
          <li>{t("attribution.weather")}</li>
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

      <Link href="/" className="self-start py-2 font-bold underline underline-offset-4">
        {tApp("home")}
      </Link>
    </main>
  );
}
