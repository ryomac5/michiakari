import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  betweenTsukamotoAmagasaki,
  expectStage,
  projectOnPage,
  readZoom,
  waitForMapStill,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// アプリを開いた直後の地図で、何も操作せずに線路の線を押すと、駅の間の候補が出て選べる
// 開いた直後の倍率は駅の印が出る倍率より引いている。前は寄るだけで、駅の間にならなかった

const screenshotDir = fileURLToPath(new URL("../screenshots/first-tap/", import.meta.url));
const choiceLocator = "[data-testid^='start-gps-choice-']";

// 描いた大阪環状線の、大阪と福島の間の点。lines.geojson の線の上の頂点の中ほど
// 開いた直後の倍率では大阪の丸の近くにあるので、丸から離れた福島の側を押す
const loopOsakaFukushima: [number, number] = [135.488845, 34.698365];
const osakaPosition: [number, number] = [135.49588, 34.70216];

type Section = {
  name: string;
  position: [number, number];
  // 候補の札の文字。駅の並びの向きは路線で決まるので、両方の向きを許す
  label: RegExp;
  key: RegExp;
  // 選んだ後の行き先の段に出る、手前の駅と路線
  picked: RegExp;
};

const tsukamotoAmagasaki: Section = {
  name: "tsukamoto-amagasaki",
  position: betweenTsukamotoAmagasaki,
  label: /JR神戸線の(塚本〜尼崎|尼崎〜塚本)の間/,
  key: /^between:jr-west\.東海道線:/,
  picked: /(塚本|尼崎)\s*JR神戸線/,
};
const osakaFukushima: Section = {
  name: "osaka-fukushima",
  position: loopOsakaFukushima,
  label: /JR環状線の(福島〜大阪|大阪〜福島)の間/,
  key: /^between:jr-west\.大阪環状線:/,
  picked: /(福島|大阪)\s*JR環状線/,
};

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

// トップを開き、地図の準備ができて止まるまで待つ。価値の 3 行も閉じず、何も操作しない
async function openTop(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await expectStage(page, "position");
  await waitForMapStill(page);
}

// 線の上の点が、価値の 3 行とシートの間に見えていて、印や札に掛かっていないことを確かめる
async function locateOnLine(page: Page, position: [number, number]) {
  const point = await projectOnPage(page, position);
  const intro = await page.getByTestId(testIds.start.intro).boundingBox();
  const introBottom = intro ? intro.y + intro.height : 0;
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  expect(point.y).toBeGreaterThan(introBottom);
  expect(point.y).toBeLessThan(sheetTop);
  expect(point.x).toBeGreaterThan(0);
  const tag = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? "",
    point,
  );
  expect(tag, "押す点は地図の線の上で、印や札に掛からない").toBe("CANVAS");
  return point;
}

// 出た候補から区間を選ぶ。1 件なら問いのはいで、複数なら候補の一覧から選ぶ
async function chooseSection(page: Page, section: Section) {
  const question = page.getByTestId(testIds.start.gpsQuestion);
  const choices = page.locator(choiceLocator);
  await expect(question.or(choices.first())).toBeVisible({ timeout: 10_000 });
  if ((await choices.count()) === 0) {
    await expect(question).toHaveText(section.label);
    return page.getByTestId(testIds.start.gpsConfirm);
  }
  expect(await choices.count()).toBeLessThanOrEqual(3);
  const target = choices.filter({ hasText: section.label });
  await expect(target).toHaveCount(1);
  return target;
}

async function tapAndPick(
  page: Page,
  section: Section,
  size: string,
  initialZoom: number,
): Promise<void> {
  const point = await locateOnLine(page, section.position);
  await page.mouse.click(point.x, point.y);
  const pick = await chooseSection(page, section);
  await expectStage(page, "position");
  await waitForMapStill(page);
  // 候補の区間を光らせ、押した区間が見える倍率まで寄せる
  const map = page.getByTestId(testIds.start.map);
  await expect(map).toHaveAttribute("data-section-focus", /^between:/);
  expect(await readZoom(page)).toBeGreaterThan(initialZoom);
  const shown = await projectOnPage(page, section.position);
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  expect(shown.y).toBeGreaterThan(0);
  expect(shown.y).toBeLessThan(sheetTop);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${section.name}-${size}.png` });

  // 区間を選ぶと、駅の間を選んだ状態で行き先の段へ進む
  const key = (await pick.getAttribute("data-testid"))?.replace("start-gps-choice-", "") ?? "";
  if (key.startsWith("between:")) expect(key).toMatch(section.key);
  await pick.click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.sheet)).toContainText(section.picked);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("開いた直後の倍率のまま、塚本と尼崎の間の線を押すと、その駅の間を選べる", async ({
      page,
    }) => {
      await openTop(page);
      const zoom = await readZoom(page);
      expect(zoom).toBeLessThan(12.5);
      await tapAndPick(page, tsukamotoAmagasaki, size, zoom);
    });
  });
}

// 375×667 の開いた直後の倍率では、大阪〜福島の線は大阪の丸の内に収まり、線だけを押せない
test.describe("390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("開いた直後の倍率のまま、大阪の丸の外の大阪〜福島の環状線を押すと、その駅の間を選べる", async ({
    page,
  }) => {
    await openTop(page);
    const zoom = await readZoom(page);
    expect(zoom).toBeLessThan(12.5);
    // 押す点は大阪の丸の中心から 14px より外にある
    const point = await projectOnPage(page, loopOsakaFukushima);
    const osaka = await projectOnPage(page, osakaPosition);
    expect(Math.hypot(point.x - osaka.x, point.y - osaka.y)).toBeGreaterThan(14);
    await tapAndPick(page, osakaFukushima, "390x844", zoom);
  });
});
