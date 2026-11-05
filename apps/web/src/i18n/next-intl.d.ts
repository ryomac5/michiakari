import type { Lang } from "@repo/schema";
import type messages from "../../messages/ja.json";

// メッセージのキーを型で検査する。ja.json を正とする
declare module "next-intl" {
  interface AppConfig {
    Locale: Lang;
    Messages: typeof messages;
  }
}
