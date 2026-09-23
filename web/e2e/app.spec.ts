import { test, expect } from "@playwright/test";
import { type Analysis } from "../src/types";

const find = async (page: any, id: string) => {
  await page.getByLabel("Найти узел по gid").fill(id);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
};

test("real data: search, isolate, unknown gid, filters, graph and CSV", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !==
      new URL(test.info().project.use.baseURL!).origin
    )
      external.push(r.url());
  });
  await page.goto("/");
  const first = data.top_nodes.find(
    (t) => !data.nodes.find((n) => n.gid === t.gid)!.is_seed,
  )!;
  await expect(page.locator(".node-id")).toHaveText(first.gid);
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("new");
  await find(page, data.nodes.find((n) => n.truncated_by_depth)!.gid);
  await expect(page.locator(".warnings")).toContainText("Граница 4-го колена");
  const isolate = data.nodes.find((n) => n.in_tx + n.out_tx === 0)!;
  await find(page, isolate.gid);
  await expect(page.locator(".node-id")).toHaveText(isolate.gid);
  await expect(page.locator(".network .empty")).toContainText(
    "Изолированный узел",
  );
  await expect(page.getByRole("img")).toHaveAttribute(
    "aria-label",
    /1 узлов, 0 связей/,
  );
  await find(page, "999");
  await expect(page.locator(".app-notice")).toContainText("не найден");
  await page.locator(".priority-filters summary").click();
  await page
    .getByLabel("Основная роль", { exact: true })
    .selectOption("transit");
  await page
    .getByLabel("Кластер", { exact: true })
    .selectOption(String(isolate.cluster_id));
  await expect(page.locator(".list .empty")).toBeVisible();
  await expect(page.locator(".details .stale-notice")).toContainText(
    "вне текущей выборки",
  );
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.locator(".gid-button").nth(1).click();
  await expect(page.locator(".node-id")).toHaveText(data.top_nodes[1].gid);
  await expect(page.locator(".details")).toBeFocused();
  await page.locator(".connections summary").click();
  await expect(page.locator(".connections tbody tr")).toHaveCount(10);
  await expect(page.locator(".connections")).toContainText("агрегированы");
  await page.locator(".exports summary").click();
  for (const [label, filename] of [
    ["Участники и роли", "nodes_roles"],
    ["Кластеры", "clusters"],
    ["Приоритеты проверки", "top_nodes"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: label, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`${filename}.csv`);
    expect(await download.failure()).toBeNull();
    expect(
      (await (await request.get(`/${filename}.csv`)).text()).split("\n").length,
    ).toBeGreaterThan(20);
  }
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

test("cluster expansion, keyboard selection and graph controls", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const cluster = data.clusters.find((c) => c.n_nodes > 80)!;
  await page.goto("/");
  await find(page, cluster.top_gids[0]);
  await page.getByLabel("Область графа").selectOption("cluster");
  await expect(page.locator(".graph-status")).toContainText(
    `30 из ${cluster.n_nodes}`,
  );
  await page.getByRole("button", { name: "Показать всё", exact: true }).click();
  await expect(page.locator(".graph-status")).toContainText(
    `${cluster.n_nodes} из ${cluster.n_nodes}`,
  );
  const first = await page.locator(".gid-button").first().textContent();
  await page.locator(".gid-button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".node-id")).toHaveText(first!);
  const zoom = await page.getByLabel("Масштаб графа").textContent();
  await page.getByRole("button", { name: "Увеличить граф" }).click();
  await expect(page.getByLabel("Масштаб графа")).not.toHaveText(zoom!);
  await page.getByRole("button", { name: "Вписать граф" }).click();
});

test("seed path, next request and resilience stay usable on mobile", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const boundary = data.nodes.find(
    (n) => n.truncated_by_depth && n.seed_path_gids.length === 5,
  )!;
  await page.goto("/");
  await find(page, boundary.gid);
  await expect(page.locator(".next-check")).toContainText("4-го колена");
  await page.getByLabel("Область графа").selectOption("path");
  await expect(page.locator(".path-details li")).toHaveCount(4);
  await expect(page.getByRole("img")).toHaveAttribute(
    "aria-label",
    /5 узлов, 4 связей/,
  );
  await expect(page.locator(".path-details")).toContainText(
    "не доказывает движение",
  );
  await page.getByText("Устойчивость наблюдаемой сети").click();
  await expect(page.locator(".resilience")).toContainText("1 877");
  await expect(page.locator(".resilience tbody tr")).toHaveCount(3);
  await expect(page.locator(".resilience tbody tr").first()).toContainText(
    "1 624",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Связи", exact: true }).click();
  await expect(page.locator(".network")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  const isolate = data.nodes.find(
    (n) => n.is_seed && n.in_tx + n.out_tx === 0,
  )!;
  await find(page, isolate.gid);
  await page.getByRole("button", { name: "Связи", exact: true }).click();
  await expect(page.locator(".path-details")).toContainText(
    "Путь от другого исходного узла",
  );
});

test("common search keeps results through invalid edits and opens either route", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const first = "100000003016635100",
    second = "100000004269433100",
    target = "100000008346837100";
  const isolate = data.nodes.find(
    (n) => n.is_seed && n.in_tx + n.out_tx === 0,
  )!.gid;
  await page.goto("/");
  await page.getByRole("button", { name: "Общие узлы", exact: true }).click();
  const input = page.getByLabel("Исходные gid"),
    submit = page.getByRole("button", { name: "Найти общие узлы" });
  await input.fill(`${first}, ${second}`);
  await submit.click();
  await expect(page.locator(".candidate-list li").first()).toContainText(
    target,
  );
  await page
    .locator(".candidate-list button")
    .filter({ hasText: target })
    .click();
  await expect(page.locator(".node-id")).toHaveText(target);
  await expect(page.locator(".details")).toBeFocused();
  await expect(page.locator(".source-path")).toHaveCount(2);
  for (const [index, length] of [2, 4].entries()) {
    await page.locator(".source-path").nth(index).click();
    await expect(page.locator(".path-details li")).toHaveCount(length);
    await expect(page.locator(".path-details")).toContainText(target);
  }
  const count = await page.locator(".result-count").textContent();
  await input.fill(`${first}, ${first}`);
  await expect(page.locator(".convergence .stale-notice")).toContainText(
    "Запрос изменён",
  );
  await submit.click();
  await expect(page.locator(".convergence [role=alert]")).toContainText(
    "не должны повторяться",
  );
  await expect(page.locator(".result-count")).toHaveText(count!);
  await input.fill(`${first}, ${target}`);
  await submit.click();
  await expect(page.locator(".convergence [role=alert]")).toContainText(
    "не найден среди исходных",
  );
  await input.fill(first);
  await submit.click();
  await expect(page.locator(".convergence [role=alert]")).toContainText(
    "от 2 до 5",
  );
  await input.fill(`${first}\n${isolate}`);
  await submit.click();
  await expect(page.locator(".convergence .empty")).toContainText(
    "Общих новых узлов",
  );
  await page.getByRole("button", { name: "Свернуть поиск" }).click();
  await expect(page.locator(".convergence")).toHaveCount(0);
  await page.getByRole("button", { name: "Общие узлы", exact: true }).click();
  await expect(input).toHaveValue(`${first}\n${isolate}`);
});
