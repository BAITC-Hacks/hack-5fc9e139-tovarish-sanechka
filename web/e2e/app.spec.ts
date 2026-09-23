import { test, expect } from "@playwright/test";

test("real data: search, isolate, unknown gid, filters, graph and CSV", async ({
  page,
  request,
}) => {
  const data = await (await request.get("/analysis.json")).json();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !==
      new URL(test.info().project.use.baseURL!).origin
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Приоритеты проверки" }),
  ).toBeVisible();
  await expect(page.locator(".node-id")).toHaveText(data.top_nodes[0].gid);
  await page
    .getByLabel("Найти узел по gid")
    .fill(data.nodes.find((n: any) => n.truncated_by_depth).gid);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.locator(".warnings")).toContainText("Граница 4-го колена");
  const isolate = data.nodes.find((n: any) => n.in_tx + n.out_tx === 0);
  await page.getByLabel("Найти узел по gid").fill(isolate.gid);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.locator(".node-id")).toHaveText(isolate.gid);
  await expect(page.locator(".network .empty")).toContainText(
    "Изолированный узел",
  );
  await expect(page.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 узлов, 0 связей/,
  );
  await page.getByLabel("Найти узел по gid").fill("999");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("не найден");
  await page.getByLabel("Роль", { exact: true }).selectOption("transit");
  await page
    .getByLabel("Кластер", { exact: true })
    .selectOption(String(isolate.cluster_id));
  await expect(page.locator(".list .empty")).toBeVisible();
  await page.getByLabel("Найти узел по gid").fill(data.top_nodes[0].gid);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.locator(".node-id")).toHaveText(data.top_nodes[0].gid);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.locator(".gid-button").nth(1).click();
  await expect(page.locator(".node-id")).toHaveText(data.top_nodes[1].gid);
  await page
    .getByText("Все переводы выбранного узла", { exact: false })
    .click();
  await expect(page.locator(".connections tbody tr")).toHaveCount(
    data.edges.filter(
      (e: any) =>
        e.src === data.top_nodes[1].gid || e.dst === data.top_nodes[1].gid,
    ).length,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "nodes_roles.csv" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("nodes_roles.csv");
  expect(await download.failure()).toBeNull();
  await page.screenshot({ path: "/tmp/hackalem-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/hackalem-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("loading and recoverable error", async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  await page.route("**/analysis.json", async (route) => {
    await pending;
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Загружаем");
  release();
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить");
  await page.unroute("**/analysis.json");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator(".node-id")).toBeVisible();
});

test("malformed data is rejected", async ({ page }) => {
  await page.route("**/analysis.json", (route) =>
    route.fulfill({ json: { schema_version: 99 } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("повреждён");
});
