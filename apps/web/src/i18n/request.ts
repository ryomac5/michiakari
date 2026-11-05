import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { localeCookieName, resolveLocale, timeZone } from "./config";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(localeCookieName)?.value);
  return {
    locale,
    timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
