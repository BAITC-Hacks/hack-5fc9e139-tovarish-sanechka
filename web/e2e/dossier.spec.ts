import { test, expect } from "@playwright/test";
import { type Analysis } from "../src/types";

test("dossier includes common-source paths, alternatives, operations and escaped notes", async ({
  page,
}) => {
  const seeds = ["100000003016635100", "100000004269433100"];
  const target = "100000000490383100";
  await page.goto(`/?selected=${target}&list=common&seeds=${seeds.join(",")}`);
  await page
    .getByLabel("Заметка аналитика", { exact: true })
    .fill("<img src=x onerror=alert(1)> Проверить\nвторую строку");
  await page.getByLabel("Включить в проверку", { exact: true }).check();
  const previous = page.url();
  await page.getByRole("button", { name: "Сформировать досье" }).click();
  await expect(
    page.getByRole("heading", { name: "Досье участника" }),
  ).toBeFocused();
  await expect(page.locator(".dossier-note")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator(".dossier-note img")).toHaveCount(0);
  await expect(
    page.getByText("Включён в список проверки.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Исходный маршрут 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Исходный маршрут 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Маршрут с учётом дат" }).first(),
  ).toBeVisible();
  await expect(page.locator(".operation-list").first()).toContainText(
    "transactions.parquet",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".dossier-actions")).toBeHidden();
  await expect(page.locator(".dossier-step svg").first()).toBeVisible();
  await page.pdf({ path: "test-results/dossier.pdf", preferCSSPageSize: true });
  await page.screenshot({
    path: "test-results/dossier-print.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Вернуться к расследованию" }).click();
  await expect(page).toHaveURL(previous);
  await expect(
    page.getByLabel("Заметка аналитика", { exact: true }),
  ).toHaveValue("<img src=x onerror=alert(1)> Проверить\nвторую строку");
});

test("sensitivity matches calculated scenarios; isolated dossier and mobile remain usable", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const node = data.nodes.find((n) => n.role === "coordinator")!;
  await page.goto(`/?selected=${node.gid}&pane=details`);
  await page
    .getByText("Устойчивость роли · чувствительна к порогам", { exact: true })
    .click();
  await expect(page.locator(".scenario-list section")).toHaveCount(3);
  await expect(page.locator(".scenario-list section").nth(2)).toContainText(
    node.role_sensitivity[2].reasons[0].replaceAll(
      "coordinator",
      "связующий узел",
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/sensitivity-mobile.png",
    fullPage: true,
  });
  await page.goto("/?selected=100000000456947100&pane=details");
  await page.getByRole("button", { name: "Сформировать досье" }).click();
  await expect(
    page.getByText(
      "Маршрут от другого исходного клиента отсутствует в наблюдаемом графе.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Вернуться к расследованию" }).click();
  await expect(page.locator("#node-details")).toBeFocused();
});
