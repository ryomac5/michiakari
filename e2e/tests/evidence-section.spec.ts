import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { loadReplayKnowledge, openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 判断の根拠の欄。聞いたことと、そこから読めるいまの段階の 2 行を、最大 3 項目で出す
// 日本語の画面に英語の id や札を出さず、事象の決まった流れや再開の時間の言い切りも出さない
// 決定論モードの agent とダミーの人身事故の知見で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const pasted = "人身事故のため、運転を見合わせています。現在、警察による現場の確認を行っています。";

const copy = {
  ja: {
    title: "判断の根拠",
    heard: "聞いたこと",
    reading: "そこから読めること",
    current: /^いまは.+の段階です。$/,
    flowWording: /よくある流れ|ふつう|[0-9０-９]+(時間|分)ほどで(再開|終わ)/,
  },
  en: {
    title: "Why we think so",
    heard: "What you heard",
    reading: "What it tells us",
    current: /^Service is now at the “.+” stage\.$/,
    flowWording: /typical flow|usually|p50|p80/i,
  },
} as const;

// 知見に出てくる id。画面の文に入ってはいけない
function listKnowledgeIds(): string[] {
  return loadReplayKnowledge().flatMap((k) => [
    k.id,
    ...k.phases.flatMap((p) => [p.id, ...p.signals.map((s) => s.id)]),
  ]);
}

async function startWithPaste(page: Page, locale: "ja" | "en"): Promise<void> {
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
  await page.getByTestId(testIds.start.method("paste")).click();
  await page.getByTestId(testIds.situation.pasteInput).fill(pasted);
  await page.getByTestId(testIds.situation.submit("paste")).click();
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

for (const locale of ["ja", "en"] as const) {
  test(`${locale} の画面で根拠を開くと、聞いたことと読めることの 2 行が 3 項目まで出る`, async ({
    page,
  }) => {
    const words = copy[locale];
    await startWithPaste(page, locale);
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
      await expect(item).toContainText(words.reading);
      await expect(item.getByTestId(testIds.judgment.evidenceHeard)).toBeVisible();
      await expect(item.getByTestId(testIds.judgment.evidenceReading)).toBeVisible();
    }
    // 最初の項目がいまの段階を読む
    await expect(items.first()).toHaveAttribute("data-current", "true");
    await expect(items.first().getByTestId(testIds.judgment.evidenceReading)).toHaveText(
      words.current,
    );
    // 聞いたことは貼り付けた発表の言葉を引く
    await expect(evidence).toContainText("人身事故のため、運転を見合わせています。");

    // 発表の引用を除いた文に、id と英字の札が入らない。英語の画面にも id は入らない
    const shown = (await evidence.textContent()) ?? "";
    const ids = listKnowledgeIds();
    for (const id of ids) expect(shown, id).not.toContain(id);
    expect(shown).not.toMatch(words.flowWording);
    if (locale === "ja") expect(shown).not.toMatch(/[A-Za-z_]/);

    // シート全体にも、事象の決まった流れや再開の時間の言い切りは出ない
    const sheet = page.getByTestId(testIds.judgment.sheet);
    await expect(sheet).not.toContainText(words.flowWording);
    // 推定である旨と公式発表を優先すべき旨は消さない
    await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();

    await evidence.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForFiniteAnimations(page);
    await page.screenshot({ path: `${screenshotDir}evidence-${locale}-390x844.png` });
  });
}
