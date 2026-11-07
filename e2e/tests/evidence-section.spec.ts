import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { ANNOUNCEMENT_CUE_IDS } from "../../packages/schema/src/judgment.ts";
import { expectJudgmentOpened, waitForJudgmentReady } from "../support/add-info.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 判断の根拠の欄。聞いたことを最大 3 項目で出し、手がかりのある項目にだけ読みを 1 行添える
// 事象の段階の名前、次の放送の例、事象の決まった流れや再開の時間の言い切りは出さない
// 日本語の画面に英語の id や札を出さない。決定論モードの agent で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

// 手がかりの無い発表と、前の列車の詰まりの手がかりを含む放送
const plain = "人身事故のため、運転を見合わせています。現在、警察による現場の確認を行っています。";
const withCue = `${plain}前の列車がつかえているため、しばらく停車いたします。`;

const copy = {
  ja: {
    title: "判断の根拠",
    heard: "聞いたこと",
    reading: "そこから読めること",
    queueReading: "動いても、前の列車が詰まって進みにくいと読めます。",
    stage: /の段階|段階です/,
    flowWording: /よくある流れ|ふつう|[0-9０-９]+(時間|分)ほどで(再開|終わ)/,
  },
  en: {
    title: "Why we think so",
    heard: "What you heard",
    reading: "What it tells us",
    queueReading: "Even once moving, trains ahead may hold you up.",
    stage: /\bstage\b/i,
    flowWording: /typical flow|usually|p50|p80/i,
  },
} as const;

async function startWithPaste(page: Page, locale: "ja" | "en", pasted: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "NEXT_LOCALE", value: locale, url: test.info().project.use.baseURL ?? "" },
    ]);
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await expectJudgmentOpened(page);

  // 発表文は判断が出てから情報を追加するで貼り、判断を出し直す
  await openSheet(page, "full");
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.scrollIntoViewIfNeeded();
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo.getByTestId(testIds.situation.pasteInput).fill(pasted);
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  await waitForJudgmentReady(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
}

for (const locale of ["ja", "en"] as const) {
  test(`${locale} の画面で根拠を開くと、聞いたことが 3 項目まで出て、段階の名前は出ない`, async ({
    page,
  }) => {
    const words = copy[locale];
    await startWithPaste(page, locale, plain);
    await openSheet(page, "full");
    const toggle = page.getByTestId(testIds.judgment.evidenceToggle);
    await expect(toggle).toHaveText(words.title);
    await toggle.click();

    const evidence = page.getByTestId(testIds.judgment.evidence);
    const items = evidence.locator("li");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await expect(item).toContainText(words.heard);
      await expect(item.getByTestId(testIds.judgment.evidenceHeard)).toBeVisible();
    }
    // 聞いたことは貼り付けた発表の言葉を引く。同じ引用は重ねない
    await expect(evidence).toContainText("人身事故のため、運転を見合わせています。");
    const heard = await evidence.getByTestId(testIds.judgment.evidenceHeard).allTextContents();
    expect(new Set(heard).size).toBe(heard.length);
    // 手がかりの無い発表なので読みの行は出さない。段階の名前と次の放送の例も出さない
    await expect(evidence.getByTestId(testIds.judgment.evidenceReading)).toHaveCount(0);
    await expect(evidence.locator("[data-phase-id]")).toHaveCount(0);
    await expect(evidence.getByTestId(testIds.judgment.evidenceNext)).toHaveCount(0);
    await expect(evidence).not.toContainText(words.stage);

    // 発表の引用を除いた文に、id と英字の札が入らない
    const shown = (await evidence.textContent()) ?? "";
    for (const id of ANNOUNCEMENT_CUE_IDS) expect(shown, id).not.toContain(id);
    expect(shown).not.toMatch(words.flowWording);
    if (locale === "ja") expect(shown).not.toMatch(/[A-Za-z_]/);

    // シート全体にも、段階の名前、事象の決まった流れ、再開の時間の言い切りは出ない
    const sheet = page.getByTestId(testIds.judgment.sheet);
    await expect(sheet).not.toContainText(words.flowWording);
    await expect(sheet).not.toContainText(words.stage);
    // 推定である旨と公式発表を優先すべき旨は消さない
    await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();

    await evidence.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForFiniteAnimations(page);
    await page.screenshot({ path: `${screenshotDir}evidence-${locale}-390x844.png` });
  });
}

test("詰まりの放送を貼り付けると、その言葉の項目に手がかりの読みが 1 行だけ付く", async ({
  page,
}) => {
  const words = copy.ja;
  await startWithPaste(page, "ja", withCue);
  await openSheet(page, "full");
  await page.getByTestId(testIds.judgment.evidenceToggle).click();
  const evidence = page.getByTestId(testIds.judgment.evidence);
  const readings = evidence.getByTestId(testIds.judgment.evidenceReading);
  await expect(readings).toHaveCount(1);
  await expect(readings).toHaveText(words.queueReading);
  const item = evidence.locator("li[data-cue-id='queue_ahead']");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(words.reading);
  await expect(item.getByTestId(testIds.judgment.evidenceHeard)).toContainText("前の列車がつかえ");
  await expect(evidence).not.toContainText(words.stage);
});

test("線路に降りる案内を貼り付けると、見込みの数字を出さず、係員の案内に従う読みを出す", async ({
  page,
}) => {
  const evacuation =
    "人身事故のため、運転を見合わせています。これから線路に降りて、最寄り駅まで歩いてご案内します。";
  await startWithPaste(page, "ja", evacuation);
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    "係員の案内に従う",
  );
  // 再開の見込みの帯と時刻、支障の無い線路の見込みは出さない
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.breakEvenResume)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.trackLine("opposite"))).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.breakEvenTime)).toHaveCount(0);
  await expect(
    page.getByTestId(testIds.judgment.conclusionLead).getByTestId(testIds.judgment.actionPill),
  ).toHaveAttribute("data-label", "followStaff");
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).not.toContainText(
    /\d{1,2}:\d{2}/,
  );
  await openSheet(page, "full");
  await page.getByTestId(testIds.judgment.evidenceToggle).click();
  const evidence = page.getByTestId(testIds.judgment.evidence);
  const readings = evidence.getByTestId(testIds.judgment.evidenceReading);
  await expect(readings).toHaveCount(1);
  await expect(readings).toHaveText("係員の案内に従ってください。");
  await expect(evidence.locator("li[data-cue-id='evacuation_on_track']")).toHaveCount(1);
  // 推定である旨と公式発表を優先すべき旨は消さない
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
});
