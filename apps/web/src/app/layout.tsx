import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { JudgmentSessionProvider } from "@/features/judgment/session";
import { loadKnowledgeCatalog } from "@/features/knowledge/load-catalog";
import { resolveTheme, themeCookieName } from "@/i18n/config";
import { cn } from "@/lib/utils";
import "./globals.css";

// 数字と英字は Inter、和文は Noto Sans JP。和文は量が多いので先読みしない
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const notoSansJp = Noto_Sans_JP({
  weight: ["400", "500", "700"],
  variable: "--font-noto-jp",
  display: "swap",
  preload: false,
});

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
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const theme = resolveTheme((await cookies()).get(themeCookieName)?.value);
  const catalog = loadKnowledgeCatalog();

  return (
    <html lang={locale} className={theme}>
      <body
        className={cn(
          inter.variable,
          notoSansJp.variable,
          "min-h-dvh bg-background font-sans text-[15px] text-foreground antialiased",
        )}
      >
        <NextIntlClientProvider>
          <JudgmentSessionProvider catalog={catalog}>{children}</JudgmentSessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
