import { test, expect } from "@playwright/test";
import { labels, type Analysis } from "../src/types";

test("consolidation includes alternative hypotheses, keeps filters and exports the full selection", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const byId = new Map(data.nodes.map((n) => [n.gid, n]));
  const expected = data.top_nodes.filter(
    (item) =>
      !byId.get(item.gid)!.is_seed &&
      byId.get(item.gid)!.role_scores.consolidator > 0,
  );
  expect(expected.some((n) => n.role !== "consolidator")).toBeTruthy();
  await page.goto("/");
  await page.locator(".priority-filters summary").click();
  await page
    .getByLabel("Основная роль", { exact: true })
    .selectOption("transit");
  await page.getByRole("button", { name: "Приоритет ↓", exact: true }).click();
  await page
    .getByLabel("Выборка", { exact: true })
    .selectOption("consolidation");
  await expect(page.getByLabel("Основная роль", { exact: true })).toHaveValue(
    "transit",
  );
  await expect(
    page.getByRole("button", { name: "Приоритет ↑", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-notice")).toContainText("сохранены");
  await page.getByLabel("Основная роль", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Приоритет ↑", exact: true }).click();
  await expect(page.locator(".list .section-head")).toContainText(
    `${expected.length} узлов`,
  );
  await page
    .locator(".list")
    .getByLabel("На странице", { exact: true })
    .selectOption("20");
  const collected: string[] = [];
  for (let offset = 0; offset < expected.length; offset += 20) {
    const batch = expected.slice(offset, offset + 20);
    await expect(page.locator(".gid-button")).toHaveText(
      batch.map((n) => n.gid),
    );
    await expect(page.locator(".global-rank")).toHaveText(
      batch.map((n) => `№ ${n.rank}`),
    );
    for (const [index, item] of batch.entries()) {
      await expect(
        page.locator(".list tbody tr").nth(index).locator(".badge"),
      ).toHaveText(labels[item.role]);
      await expect(page.locator(".list tbody tr").nth(index)).toContainText(
        "Признаки консолидации",
      );
    }
    collected.push(...(await page.locator(".gid-button").allTextContents()));
    if (offset + 20 < expected.length)
      await page
        .locator(".list")
        .getByRole("button", { name: "Далее", exact: true })
        .click();
  }
  expect(collected).toEqual(expected.map((n) => n.gid));
  await page.locator(".list").getByLabel("Страница", { exact: true }).fill("1");
  await expect(page.locator(".gid-button").first()).toHaveText(expected[0].gid);
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: `Выгрузить выборку (${expected.length})`,
      exact: true,
    })
    .click();
  const download = await waiting;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv.split("\r\n")).toHaveLength(expected.length + 1);
  expect(csv).toContain(expected.at(-1)!.gid);
  const isolate = data.nodes.find(
    (n) => n.is_seed && n.in_tx + n.out_tx === 0,
  )!;
  await page
    .getByLabel("Кластер", { exact: true })
    .selectOption(String(isolate.cluster_id));
  await expect(page.locator(".list .empty")).toContainText(
    "Новых точек консолидации",
  );
  await page
    .getByRole("button", { name: "Показать все узлы", exact: true })
    .click();
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("all");
  await expect(page.locator(".gid-button").first()).toHaveText(
    data.top_nodes[0].gid,
  );
});
