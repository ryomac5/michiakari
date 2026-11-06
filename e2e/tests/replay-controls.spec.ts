import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { loadReplayScenarios, openReplay, waitForJudged } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// リプレイの見出しの帯の操作。狭い画面でも押せる大きさを保ち、途中から最初に戻せること
// 再生を始める前から、推定である旨と公式発表を優先すべき旨が出ること

const scenario = loadReplayScenarios().find((s) => s.timeline.length >= 2);

test.use({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test("375×667 で、再生の前に注意書きが出て、帯の操作は 44px 以上で、途中から最初に戻せる", async ({
  page,
}) => {
  if (!scenario) throw new Error("観測が 2 件以上あるシナリオがありません");
  await openReplay(page, scenario.id);

  // 再生を始める前の注意書き
  const disclaimer = page.getByTestId(testIds.judgment.disclaimer);
  await expect(disclaimer).toContainText("推定であり、公式発表を優先してください");
  await expect(disclaimer).toBeInViewport({ ratio: 1 });

  // 帯の中の押せる部品は、幅も高さも 44px 以上
  const bar = page.getByTestId(testIds.replay.bar);
  const sizes = await bar.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((b) => b.getBoundingClientRect().width > 1)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.getAttribute("data-testid"), w: r.width, h: r.height, right: r.right };
      }),
  );
  for (const size of sizes) {
    expect(size.w, `${size.id} の幅が 44px 未満`).toBeGreaterThanOrEqual(44);
    expect(size.h, `${size.id} の高さが 44px 未満`).toBeGreaterThanOrEqual(44);
    expect(size.right, `${size.id} が画面からはみ出している`).toBeLessThanOrEqual(375);
  }
  expect(sizes.map((s) => s.id)).toContain(testIds.replay.speedToggle);
  expect(sizes.map((s) => s.id)).toContain(testIds.replay.restartButton);

  // 速度は 1 つのボタンで順に切り替わる
  const speed = page.getByTestId(testIds.replay.speedToggle);
  const before = await speed.getAttribute("data-speed");
  await speed.click();
  await expect(speed).not.toHaveAttribute("data-speed", before ?? "");

  // 途中まで進めてから、最初に戻せる
  const restart = page.getByTestId(testIds.replay.restartButton);
  await expect(restart).toBeDisabled();
  for (const entry of scenario.timeline.slice(0, 2)) {
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, entry.id);
  }
  const progress = page.getByTestId(testIds.replay.progress);
  await expect(progress).toHaveAttribute("data-entered", "2");
  await expect(restart).toBeVisible();
  await expect(restart).toBeEnabled();
  await restart.click();
  await expect(progress).toHaveAttribute("data-entered", "0");
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle");
  await expect(disclaimer).toBeInViewport({ ratio: 1 });
});
