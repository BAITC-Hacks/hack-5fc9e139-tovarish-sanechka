import { test, expect } from "@playwright/test";
import { labels, type Analysis } from "../src/types";

test("new consolidation candidates include alternative roles and preserve global priority", async ({ page, request }) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const byId = new Map(data.nodes.map((node) => [node.gid, node]));
  const expected = data.top_nodes.filter((item) => {
    const node = byId.get(item.gid)!;
    return !node.is_seed && node.role_scores.consolidator > 0;
  });
  expect(expected.some((node) => node.role === "consolidator")).toBeTruthy();
  expect(expected.some((node) => node.role !== "consolidator")).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  // Start with unrelated filters and reverse sorting; the new view resets them.
  await page.getByLabel("Роль", { exact: true }).selectOption("terminal");
  await page.getByLabel("Кластер", { exact: true }).selectOption(String(data.clusters[0].cluster_id));
  await page.getByRole("button", { name: "Приоритет ↓", exact: true }).click();
  await page.getByLabel("Выборка", { exact: true }).selectOption("consolidation");
  await expect(page.getByLabel("Роль", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Кластер", { exact: true })).toHaveValue("");
  await expect(page.locator(".list .section-head")).toContainText(`${expected.length} узлов`);
  await expect(page.getByRole("button", { name: "Приоритет ↓", exact: true })).toBeVisible();

  const collected: string[] = [];
  for (let offset = 0; offset < expected.length; offset += 20) {
    const batch = expected.slice(offset, offset + 20);
    await expect(page.locator(".gid-button")).toHaveText(batch.map((node) => node.gid));
    await expect(page.locator(".global-rank")).toHaveText(batch.map((node) => `№ ${node.rank}`));
    for (const [index, item] of batch.entries()) {
      const row = page.locator(".list tbody tr").nth(index);
      await expect(row.locator(".badge")).toHaveText(labels[item.role]);
      await expect(row).toContainText("Признаки консолидации");
    }
    collected.push(...await page.locator(".gid-button").allTextContents());
    if (offset + 20 < expected.length)
      await page.locator(".list").getByRole("button", { name: "Далее", exact: true }).click();
  }
  expect(collected).toEqual(expected.map((node) => node.gid));

  const isolate = data.nodes.find((node) => node.is_seed && node.in_tx + node.out_tx === 0)!;
  await page.getByLabel("Найти узел по gid").fill(isolate.gid);
  await page.getByLabel("Найти узел по gid").press("Enter");
  await expect(page.locator(".node-id")).toHaveText(isolate.gid);
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("consolidation");
  await page.getByLabel("Кластер", { exact: true }).selectOption(String(isolate.cluster_id));
  await expect(page.locator(".list .empty")).toContainText("Новых точек консолидации");
  await page.getByRole("button", { name: "Показать все узлы", exact: true }).click();
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("all");
  await expect(page.getByLabel("Роль", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Кластер", { exact: true })).toHaveValue("");
  await expect(page.locator(".gid-button").first()).toHaveText(data.top_nodes[0].gid);

  await page.getByLabel("Выборка", { exact: true }).selectOption("consolidation");
  const alternative = expected.find((node) => node.role !== "consolidator")!;
  await page.getByLabel("Найти узел по gid").fill(alternative.gid);
  await page.getByLabel("Найти узел по gid").press("Enter");
  await expect(page.locator(".node-id")).toHaveText(alternative.gid);
  await expect(page.locator(".details .facts").first()).toContainText(`№ ${alternative.rank} из`);
  await page.getByLabel("Область графа").selectOption("path");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/hackalem-consolidation-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "/tmp/hackalem-consolidation-mobile.png", fullPage: true });
  await page.locator(".gid-button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".node-id")).toHaveText(expected[0].gid);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("all");
  await expect(page.locator(".gid-button").first()).toHaveText(data.top_nodes[0].gid);
  expect(errors).toEqual([]);
});
