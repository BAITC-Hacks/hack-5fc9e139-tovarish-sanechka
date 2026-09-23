import { test, expect, type Page } from "@playwright/test";
import { type Analysis, labels, points, roles } from "../src/types";

const firstSeed = "100000003016635100",
  secondSeed = "100000004269433100";
async function find(page: Page, gid: string) {
  await page.getByLabel("Найти узел по gid").fill(gid);
  await page.getByLabel("Найти узел по gid").press("Enter");
}
async function common(page: Page) {
  await page.getByRole("button", { name: "Общие узлы", exact: true }).click();
  await page.getByLabel("Исходные gid").fill(`${firstSeed}, ${secondSeed}`);
  await page
    .getByRole("button", { name: "Найти общие узлы", exact: true })
    .click();
}

test("history, reload and a shared URL restore the full investigation", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const initial = await page.locator(".node-id").textContent();
  const next = await page.locator(".gid-button").nth(1).textContent();
  await page.locator(".gid-button").nth(1).click();
  await expect(page.locator(".node-id")).toHaveText(next!);
  await page.goBack();
  await expect(page.locator(".node-id")).toHaveText(initial!);
  await page.goForward();
  await expect(page.locator(".node-id")).toHaveText(next!);
  await page
    .getByLabel("Выборка", { exact: true })
    .selectOption("consolidation");
  await page.locator(".priority-filters summary").click();
  await page
    .getByLabel("Основная роль", { exact: true })
    .selectOption("distributor");
  await page
    .locator(".list")
    .getByLabel("На странице", { exact: true })
    .selectOption("50");
  await common(page);
  await page.locator(".candidate-list button").first().click();
  await page.locator(".source-path").nth(1).click();
  const target = await page.locator(".node-id").textContent();
  const path = await page.locator(".path-step").allTextContents();
  const url = page.url();
  await page.reload();
  await expect(page.locator(".node-id")).toHaveText(target!);
  await expect(page.getByLabel("Исходные gid")).toHaveValue(
    `${firstSeed}, ${secondSeed}`,
  );
  await expect(page.locator(".path-step")).toHaveText(path);
  const shared = await context.newPage();
  await shared.goto(url);
  await expect(shared.locator(".node-id")).toHaveText(target!);
  await expect(shared.locator(".path-step")).toHaveText(path);
  await shared.getByRole("button", { name: "Свернуть поиск" }).click();
  await expect(shared.getByLabel("Выборка", { exact: true })).toHaveValue(
    "consolidation",
  );
  await shared.locator(".priority-filters summary").click();
  await expect(shared.getByLabel("Основная роль", { exact: true })).toHaveValue(
    "distributor",
  );
  await expect(
    shared.locator(".list").getByLabel("На странице", { exact: true }),
  ).toHaveValue("50");
  await shared.close();
});

test("analyst decisions survive reload and export quoted notes without formulas", async ({
  page,
}) => {
  await page.goto("/");
  const gid = await page.locator(".node-id").textContent();
  await page.getByLabel("Включить в проверку", { exact: true }).check();
  const note = '=HYPERLINK("https://example.invalid")\nПроверить, "июль"';
  await page.getByLabel("Заметка аналитика").fill(note);
  await expect(page.locator(".decision [role=status]")).toContainText(
    "Сохранено",
  );
  await page.reload();
  await expect(
    page.getByLabel("Включить в проверку", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Заметка аналитика")).toHaveValue(note);
  await page.getByLabel("Выборка", { exact: true }).selectOption("shortlist");
  await expect(page.locator(".gid-button")).toHaveText([gid!]);
  await page.locator(".exports summary").click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Список проверки (1)", exact: true })
    .click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain(`"${gid}"`);
  expect(csv).toContain(
    '"\'=HYPERLINK(""https://example.invalid"")\nПроверить, ""июль"""',
  );
  await page.getByLabel("Включить в проверку", { exact: true }).uncheck();
  await expect(page.locator(".list .empty")).toContainText(
    "Список проверки пуст",
  );
  await page.reload();
  await expect(
    page.getByLabel("Включить в проверку", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Заметка аналитика")).toHaveValue(note);
});

test("storage failure is visible and does not overwrite unreadable records", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.goto("/");
  await expect(page.locator(".decision [role=status]")).toContainText(
    "Не удалось прочитать",
  );
  await page.getByLabel("Включить в проверку", { exact: true }).check();
  await page.getByLabel("Выборка", { exact: true }).selectOption("shortlist");
  await expect(page.locator(".gid-button")).toHaveCount(1);
  await expect(page.locator(".decision [role=status]")).toContainText(
    "только до перезагрузки",
  );
});

test("common search filters actual paths independently and supports source selection", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  await page.goto("/");
  await find(page, firstSeed);
  await page.getByRole("button", { name: "Общие узлы", exact: true }).click();
  await page.locator(".source-picker summary").click();
  await page
    .getByRole("button", { name: "Добавить открытого клиента" })
    .click();
  await page.getByLabel("Выбор исходного клиента").selectOption(secondSeed);
  await page
    .getByRole("button", { name: "Добавить в запрос", exact: true })
    .click();
  await expect(page.getByLabel("Исходные gid")).toHaveValue(
    `${firstSeed}, ${secondSeed}`,
  );
  await page
    .getByRole("button", { name: "Найти общие узлы", exact: true })
    .click();
  await page.getByLabel("Основная роль кандидата").selectOption("transit");
  const ids = await page
    .locator(".candidate-list button span:first-child")
    .allTextContents();
  expect(ids.length).toBeGreaterThan(0);
  for (const text of ids)
    expect(data.nodes.find((n) => text.includes(n.gid))!.role).toBe("transit");
  await page.getByLabel("Не больше шагов").fill("1");
  await expect(page.locator(".convergence .empty")).toContainText(
    "Нет кандидатов",
  );
  await page.getByLabel("Не больше шагов").fill("0");
  await page.getByLabel("Основная роль кандидата").selectOption("");
  await page.getByLabel("Даты маршрутов").selectOption("ordered");
  await expect(page.locator(".candidate-list li").first()).toContainText(
    "Даты согласованы",
  );
  await page.locator(".candidate-list button").first().click();
  for (let index = 0; index < 2; index++) {
    await page.locator(".source-path").nth(index).click();
    await expect(
      page.locator(".path-details .chronology-status"),
    ).toContainText(/согласована|Один шаг/);
  }
  await page.getByRole("button", { name: "Свернуть поиск" }).click();
  await expect(page.getByLabel("Выборка", { exact: true })).toHaveValue("new");
});

test("role thresholds and competing scores come from the supplied calculation", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  await page.goto("/");
  for (const role of roles) {
    const node = data.nodes.find((n) => n.role === role)!;
    await find(page, node.gid);
    await expect(page.locator(".role-rules")).toBeVisible();
    await expect(page.locator(".score-explanation")).toContainText(
      "не вероятность",
    );
    await expect(page.locator(".details .facts").first()).toContainText(
      `${points(node.priority_score)} / 100`,
    );
    if (role !== "peripheral")
      await expect(page.locator(".role-rules")).toContainText("порог");
    await expect(page.locator(".evidence")).not.toContainText(
      /seed|depth=|out\/in/,
    );
  }
  const node = data.nodes.find((n) => n.role === "consolidator")!;
  await find(page, node.gid);
  await expect(page.locator(".role-rules")).toContainText(
    `${node.in_deg} плательщиков при пороге ≥ ${data.meta.config.thresholds.min_payers}`,
  );
  await page
    .getByText("Все признаки и альтернативные роли", { exact: true })
    .click();
  const alternatives = page
    .locator(".details details")
    .filter({
      has: page.getByText("Все признаки и альтернативные роли", {
        exact: true,
      }),
    });
  for (const role of roles) {
    const score = alternatives
      .locator("dt")
      .filter({ hasText: new RegExp(`^${labels[role]}$`) });
    await expect(score).toHaveCount(node.role_scores[role] > 0 ? 1 : 0);
  }
  await expect(alternatives).toContainText("Основная оценка снижена");
});

test("desktop and mobile keep selection visible, with one mobile scroll and matching focus order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".node-id")).toBeVisible();
  expect((await page.locator(".workspace").boundingBox())!.y).toBeLessThan(250);
  expect((await page.locator(".list").boundingBox())!.height).toBeLessThan(
    1100,
  );
  await common(page);
  expect((await page.locator(".network").boundingBox())!.y).toBeLessThan(250);
  await page.screenshot({
    path: "/tmp/hackalem-common-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Свернуть поиск" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".list")).toBeVisible();
  await expect(page.locator(".details")).not.toBeVisible();
  expect((await page.locator(".list").boundingBox())!.y).toBeLessThan(450);
  await page.locator(".gid-button").first().focus();
  expect(
    (await page.locator(".gid-button").first().boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(page.locator(".details")).toBeFocused();
  await expect(page.locator(".details")).toBeInViewport();
  await expect(page.locator(".list")).not.toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Копировать gid", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "/tmp/hackalem-details-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Связи", exact: true }).click();
  await page.locator(".connections summary").click();
  await page.screenshot({
    path: "/tmp/hackalem-network-mobile.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const scrollAreas = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((e) => {
        const style = getComputedStyle(e);
        return (
          e.getBoundingClientRect().width &&
          /auto|scroll/.test(style.overflowY) &&
          e.scrollHeight > e.clientHeight
        );
      })
      .map((e) => e.className),
  );
  expect(scrollAreas).toEqual([]);
});

test("unknown links recover and clipboard actions work", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?selected=999&mode=invalid&pageSize=0");
  await expect(page.locator(".app-notice")).toContainText("отсутствует");
  const gid = await page.locator(".node-id").textContent();
  await page
    .getByRole("button", { name: "Копировать gid", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(gid);
  await page
    .getByRole("button", { name: "Копировать ссылку", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    page.url(),
  );
});

test("graph has readable ranks, weighted flows, inspectable amounts and a marked date conflict", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".node-id")).toBeVisible();
  const graph = page.locator(".graph");
  // Inspect the rendered Cytoscape instance, including computed styles used by canvas.
  const neighborhood = await graph.evaluate((element: any) => {
    const cy = element._cyreg.cy;
    return {
      count: cy.nodes().length,
      widths: cy.edges().map((edge: any) => edge.numericStyle("width")),
      labels: cy
        .nodes()
        .map((node: any) => ({
          label: node.data("label"),
          size: parseFloat(node.renderedStyle("font-size")),
        })),
    };
  });
  expect(neighborhood.count).toBeLessThanOrEqual(12);
  expect(new Set(neighborhood.widths).size).toBeGreaterThan(1);
  expect(
    neighborhood.labels.every(
      (label: any) => /^№ \d+$/.test(label.label) && label.size >= 12,
    ),
  ).toBeTruthy();
  await graph.evaluate((element: any) =>
    element._cyreg.cy.edges().first().emit("tap"),
  );
  await expect(page.locator(".graph-inspection")).toContainText(/₸.*операций/);
  await common(page);
  await page.locator(".candidate-list button").first().click();
  await page.locator(".source-path").last().click();
  const conflict = await graph.evaluate((element: any) => {
    const edge = element._cyreg.cy.edges(".conflict");
    return {
      count: edge.length,
      style: edge.style("line-style"),
      color: edge.style("line-color"),
      size: parseFloat(edge.renderedStyle("font-size")),
    };
  });
  expect(conflict).toEqual({
    count: 1,
    style: "dashed",
    color: "rgb(179,53,44)",
    size: 13,
  });
  await expect(page.locator(".conflict-key")).toContainText("на шаге 3");
  await page.screenshot({
    path: "/tmp/hackalem-weighted-path-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/hackalem-weighted-path-mobile.png",
    fullPage: true,
  });
});
