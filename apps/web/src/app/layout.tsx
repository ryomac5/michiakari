import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { JudgmentSessionProvider } from "@/features/judgment/session";
import { loadKnowledgeCatalog } from "@/features/knowledge/load-catalog";
import { resolveTheme, themeCookieName } from "@/i18n/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  const title = `${t("name")} — ${t("tagline")}`;
  return {
    title: { default: title, template: `%s | ${t("name")}` },
    description: t("description"),
    applicationName: t("name"),
    openGraph: { title, description: t("description"), siteName: t("name"), type: "website" },
    twitter: { card: "summary", title, description: t("description") },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d1218",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const theme = resolveTheme((await cookies()).get(themeCookieName)?.value);
  const catalog = loadKnowledgeCatalog();

  return (
    <html lang={locale} className={theme}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider>
          <JudgmentSessionProvider catalog={catalog}>
            <AppHeader initialTheme={theme} />
            {children}
          </JudgmentSessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
