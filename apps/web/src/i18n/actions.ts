"use server";

import type { Lang } from "@repo/schema";
import { cookies } from "next/headers";
import { localeCookieName, resolveLocale } from "./config";

// 言語を cookie に保存する。画面側で router.refresh() して反映する
export async function saveLocale(locale: Lang): Promise<void> {
  const store = await cookies();
  store.set(localeCookieName, resolveLocale(locale), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
