import { expect, test } from "@playwright/test";

test("web のトップに見出しと注意書きが表示される", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("推定であり、公式発表を優先してください")).toBeVisible();
});

test("agent の /health が ok を返す", async ({ request }) => {
  const res = await request.get("http://localhost:8787/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok" });
});
