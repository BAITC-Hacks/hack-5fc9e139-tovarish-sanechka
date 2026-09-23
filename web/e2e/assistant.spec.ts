import { test, expect } from "@playwright/test";
import { validateReply } from "../src/Assistant";
import { type Analysis } from "../src/types";

const source = "100000003016635100",
  other = "100000004269433100",
  target = "100000000490383100";

test("assistant renders verified cards, sends minimal context and navigates only on click", async ({
  page,
}) => {
  await page.route("**/api/assistant/status", (route) =>
    route.fulfill({ json: { enabled: true, message: "" } }),
  );
  const bodies: unknown[] = [];
  await page.route("**/api/assistant/interpret", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        operations:
          bodies.length === 1
            ? [
                { type: "node", gid: target },
                { type: "sensitivity", gid: target },
                { type: "route", source, target },
              ]
            : [{ type: "common", seeds: [source, other] }],
      },
    });
  });
  await page.goto(`/?selected=${target}&seeds=${source},${other}`);
  await page
    .getByLabel("Заметка аналитика", { exact: true })
    .fill("Private note never sent");
  await page.getByRole("button", { name: "AI-ассистент", exact: true }).click();
  await expect(page.getByLabel("Вопрос ассистенту")).toBeFocused();
  await page
    .getByLabel("Вопрос ассистенту")
    .fill("Объясни роль и пороги, покажи путь от первого источника");
  const before = page.url();
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(page.locator(".assistant-result")).toHaveCount(3);
  await expect(page).toHaveURL(before);
  expect(JSON.stringify(bodies)).not.toMatch(
    /Private note|role_scores|operations|API_KEY/,
  );
  await expect(page.locator(".assistant-result").last()).toContainText(
    "2026-07-11 → 2026-07-19",
  );
  await page
    .getByRole("button", { name: "Показать маршрут", exact: true })
    .click();
  await expect(page.locator(".assistant-panel")).toBeHidden();
  await expect(
    page.getByText("Показан маршрут, найденный с учётом дат."),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI-ассистент", exact: true }).click();
  await page
    .getByLabel("Вопрос ассистенту")
    .fill("Кто получает от этих исходных?");
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Общие достижимые участники" }),
  ).toBeVisible();
  expect((bodies[1] as { history: string[] }).history).toHaveLength(1);
  await page.screenshot({
    path: "test-results/assistant-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Открыть общий поиск" }).click();
  await expect(page.getByLabel("Исходные gid", { exact: true })).toHaveValue(
    `${source}, ${other}`,
  );
  await expect(page.locator("#candidate-panel")).toBeFocused();
});

test("assistant unavailable, retry, clarification, cancellation and malformed responses", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  expect(() =>
    validateReply({ operations: [{ type: "node", gid: "404" }] }, data),
  ).toThrow();
  let enabled = false;
  await page.route("**/api/assistant/status", (route) =>
    route.fulfill({
      json: {
        enabled,
        message: enabled ? "" : "AI не настроен. Основные функции доступны.",
      },
    }),
  );
  await page.goto(`/?selected=${target}&pane=details`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "AI-ассистент", exact: true }).click();
  await expect(
    page.getByText("AI не настроен. Основные функции доступны.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Спросить", exact: true }),
  ).toBeDisabled();
  enabled = true;
  await page.getByRole("button", { name: "Проверить снова" }).click();
  await page.route("**/api/assistant/interpret", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "Достигнут лимит Alem. Повторите позже." },
    }),
  );
  await page.getByLabel("Вопрос ассистенту").fill("Что проверить?");
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("лимит");
  await expect(page.getByLabel("Вопрос ассистенту")).toHaveValue(
    "Что проверить?",
  );
  await page.route("**/api/assistant/interpret", (route) =>
    route.fulfill({ json: { clarification: "missing_context" } }),
  );
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await expect(
    page.getByText("Уточните идентификаторы участников и действие:", {
      exact: false,
    }),
  ).toBeVisible();
  await page.route("**/api/assistant/interpret", (route) =>
    route.fulfill({
      json: { operations: [{ type: "execute", code: "alert(1)" }] },
    }),
  );
  await page.getByLabel("Вопрос ассистенту").fill("Покажи карточку");
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("некорректный");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/assistant/interpret", async (route) => {
    await waiting;
    await route.fulfill({ json: { clarification: "unsupported" } });
  });
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await page.getByRole("button", { name: "Отменить запрос" }).click();
  release();
  await expect(page.getByRole("alert")).toContainText("отменён");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/assistant-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Закрыть ассистента" }).click();
  await expect(
    page.getByRole("button", { name: "AI-ассистент", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Сформировать досье" }).click();
  await expect(
    page.getByRole("heading", { name: "Досье участника" }),
  ).toBeVisible();
});
