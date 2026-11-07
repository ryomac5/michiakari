import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  betweenTsukamotoAmagasaki,
  expectStage,
  findCanvasPointNear,
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

// 候補の区間の両端の駅。候補の札の key に出る駅の名前から引く
const stationPositions: Record<string, [number, number]> = {
  塚本: [135.46889, 34.71273],
  尼崎: [135.43178, 34.73185],
  御幣島: [135.45561, 34.71269],
  加島: [135.45359, 34.72778],
  大阪: [135.49588, 34.70216],
  福島: [135.48658, 34.69718],
  大阪梅田: [135.49728, 34.70152],
  東部市場前: [135.53768, 34.63809],
  平野: [135.55103, 34.63091],
  十三: [135.4821, 34.72025],
  神崎川: [135.47313, 34.73198],
  園田: [135.44811, 34.75185],
  千船: [135.44535, 34.71226],
  姫島: [135.45819, 34.70435],
  杭瀬: [135.43868, 34.71831],
  出来島: [135.43685, 34.70727],
  海老江: [135.47297, 34.69565],
  新福島: [135.48556, 34.69488],
};

// 出ている候補の key。1 件の問いは key を出さないので、地図で光らせている区間の key を使う
async function readShownKeys(page: Page): Promise<string[]> {
  const ids = await page
    .locator(choiceLocator)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
  if (ids.length > 0) return ids.map((id) => id.replace("start-gps-choice-", ""));
  const focus = await page.getByTestId(testIds.start.map).getAttribute("data-section-focus");
  return focus ? [focus] : [];
}

// 全部の候補の区間の両端が、上部の帯とシートの間に見えている
async function expectChoiceEndsVisible(page: Page) {
  const keys = await readShownKeys(page);
  expect(keys.length).toBeGreaterThan(0);
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  const width = page.viewportSize()?.width ?? 390;
  for (const key of keys) {
    // 同じ名前の駅の id は「平野-2」のように番号が付くので、名前に戻す
    const [, , from, to] = key.split(":").map((id) => id.replace(/-\d+$/, ""));
    for (const name of [from, to]) {
      const position = name ? stationPositions[name] : undefined;
      if (!position) throw new Error(`${key} の ${name} の位置がありません`);
      const point = await projectOnPage(page, position);
      expect(point.x, `${name} が画面の横に収まる`).toBeGreaterThanOrEqual(0);
      expect(point.x, `${name} が画面の横に収まる`).toBeLessThanOrEqual(width);
      expect(point.y, `${name} が上部の帯の下にある`).toBeGreaterThan(56);
      expect(point.y, `${name} がシートの上にある`).toBeLessThan(sheetTop);
    }
  }
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
  // 長い区間や離れた候補でも、全部の候補の両端が見える倍率に留める
  await expectChoiceEndsVisible(page);
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

// 引いた地図で押して寄せた後に候補を閉じても、全体の地図へ戻さず、寄せた所を保つ
// 開いた直後の 390×844 で東部市場前〜平野を押すと、候補が 1 件の問いになる
test.describe("候補を閉じる 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("開いた直後の倍率で線を押して寄せた後、違うで閉じても、寄せた倍率と場所を保つ", async ({
    page,
  }) => {
    await openTop(page);
    const initialZoom = await readZoom(page);
    const middle = await projectOnPage(page, [135.544355, 34.6345]);
    const point = await findCanvasPointNear(page, middle);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
      /JR大和路線の(東部市場前〜平野|平野〜東部市場前)の間ですか/,
    );
    await waitForMapStill(page);
    await expectChoiceEndsVisible(page);
    const map = page.getByTestId(testIds.start.map);
    const zoom = await readZoom(page);
    expect(zoom).toBeGreaterThan(initialZoom);
    const center = await map.getAttribute("data-center");

    await page.getByTestId(testIds.start.gpsDismiss).click();
    await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);
    // 閉じた後に視点が動き出すなら、その動きが始まるまで待ってから確かめる
    await page.waitForTimeout(1000);
    await waitForMapStill(page);
    await expectStage(page, "position");
    expect(await readZoom(page)).toBeCloseTo(zoom, 1);
    const [lon, lat] = (center ?? "0,0").split(",").map(Number) as [number, number];
    const [afterLon, afterLat] = ((await map.getAttribute("data-center")) ?? "0,0")
      .split(",")
      .map(Number) as [number, number];
    expect(afterLon).toBeCloseTo(lon, 3);
    expect(afterLat).toBeCloseTo(lat, 3);
  });
});
