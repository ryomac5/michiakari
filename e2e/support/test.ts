import { readFileSync } from "node:fs";
import { type BrowserContext, test as base, expect } from "@playwright/test";
import { stubExternal } from "../servers.ts";

// 全テストで共有する test。外部の地図タイルとフォントを取りに行かず、e2e/fixtures の固定データで応える
// 外部の取得の遅さで地図の準備が終わらない失敗を避ける
// E2E_REAL_TILES=1 のときは差し替えない。録画は record/ で @playwright/test をそのまま使うので本物のタイルになる

const paleTile = readFileSync(new URL("../fixtures/tiles/pale.png", import.meta.url));
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const fontPattern = /\.(woff2?|ttf|otf|pbf)$/i;

export async function stubExternalRequests(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => !localHosts.has(url.hostname),
    (route) => {
      const request = route.request();
      if (request.resourceType() === "image" || /\.(png|jpe?g|webp)$/i.test(request.url())) {
        return route.fulfill({ status: 200, contentType: "image/png", body: paleTile });
      }
      if (fontPattern.test(new URL(request.url()).pathname)) {
        return route.fulfill({ status: 404, body: "" });
      }
      // それ以外の外部要求は e2e で使わない前提なので、待たずに断る
      return route.abort("blockedbyclient");
    },
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    if (stubExternal) await stubExternalRequests(context);
    await use(context);
  },
});

export { expect };
