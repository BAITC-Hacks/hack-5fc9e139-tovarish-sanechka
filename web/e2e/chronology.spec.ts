import { test, expect } from "@playwright/test";
import { checkPathChronology } from "../src/PathChronology";
import { validateAnalysis, type Analysis } from "../src/types";

const ids = ["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004"];

function pathData(base: Analysis, dates: string[][]): Analysis {
  const nodes = ids.map((gid, index) => ({
    ...base.nodes[0], gid, is_seed: index < 2, depth: Math.max(0, index - 1),
    cluster_id: 0, priority_score: (4 - index) / 4,
    reachable_seed_count: index < 2 ? 0 : 2,
    seed_path_gids: index < 2 ? [gid] : index === 2 ? [ids[0], gid] : [ids[0], ids[2], gid],
  }));
  const pairs = [[ids[0], ids[2]], [ids[1], ids[2]], [ids[2], ids[3]]];
  const edges = pairs.map(([src, dst], index) => ({
    id: `edge:${src}:${dst}`, src, dst, depth: index === 2 ? 2 : 1,
    sum_kzt: 10000, n_tx: dates[index === 2 ? 1 : 0].length,
    dates: dates[index === 2 ? 1 : 0],
  }));
  return {
    ...base, nodes, edges,
    meta: { ...base.meta, n_nodes: 4, n_edges: 3, n_transactions: edges.reduce((sum, e) => sum + e.n_tx, 0) },
    top_nodes: nodes.map((node, index) => ({ ...node, rank: index + 1, why: node.evidence })),
    clusters: [{ cluster_id: 0, n_nodes: 4, n_seed: 2, sum_kzt_internal: 30000,
      top_gids: ids, hypothesis: "Тестовая сеть" }],
    resilience: { ...base.resilience, baseline_largest_component: 4, scenarios: [] },
  };
}

const cases = [
  { name: "increasing", dates: [["2026-07-01"], ["2026-07-02"]], status: "ordered", text: "Последовательность дат согласована", chosen: ["2026-07-01", "2026-07-02"] },
  { name: "same day", dates: [["2026-07-02"], ["2026-07-02"]], status: "same_day", text: "Порядок внутри дня неизвестен", chosen: ["2026-07-02", "2026-07-02"] },
  { name: "backwards", dates: [["2026-07-03"], ["2026-07-02"]], status: "inconsistent", text: "Выбранный путь не согласован по датам", chosen: ["2026-07-03"] },
  { name: "strict alternative to same day", dates: [["2026-07-01"], ["2026-07-01", "2026-07-03"]], status: "ordered", text: "Последовательность дат согласована", chosen: ["2026-07-01", "2026-07-03"] },
];

for (const scenario of cases) {
  test(`chronology: ${scenario.name} in both path views`, async ({ page, request }) => {
    const base: Analysis = await (await request.get("/analysis.json")).json();
    const data = pathData(base, scenario.dates);
    expect(validateAnalysis(data)).toBe(data);
    const result = checkPathChronology(scenario.dates.map((dates) => ({ dates })));
    expect(result.status).toBe(scenario.status);
    expect(result.dates).toEqual(scenario.chosen);
    await page.route("**/analysis.json", (route) => route.fulfill({ json: data }));
    await page.goto("/");
    await page.getByLabel("Найти узел по gid").fill(ids[3]);
    await page.getByLabel("Найти узел по gid").press("Enter");
    await page.getByLabel("Область графа").selectOption("path");
    await expect(page.locator(".path-details .chronology-status")).toHaveText(scenario.text);
    for (const [index, day] of scenario.chosen.entries())
      await expect(page.locator(".path-details li").nth(index)).toContainText(`Дата операции: ${day}`);
    if (scenario.status === "inconsistent") {
      await expect(page.locator(".path-details")).toContainText("прерывается на шаге 2");
      await expect(page.locator(".path-details")).toContainText("Доступные даты: 2026-07-02");
    }
    await page.getByLabel("Исходные gid").fill(`${ids[0]}, ${ids[1]}`);
    await page.getByRole("button", { name: "Найти общие узлы" }).click();
    await expect(page.locator(".source-path .chronology-status")).toHaveText([scenario.text, scenario.text]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    if (scenario.status === "inconsistent") {
      await page.screenshot({ path: "/tmp/hackalem-chronology-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: "/tmp/hackalem-chronology-desktop.png", fullPage: true });
    }
  });
}

test("chronology handles a single edge, an empty path and invalid dates", async ({ page, request }) => {
  const base: Analysis = await (await request.get("/analysis.json")).json();
  const data = pathData(base, [["2026-07-01"], ["2026-07-02"]]);
  for (const dates of [undefined, [], ["2026-07-02", "2026-07-01"], ["2026-07-01", "2026-07-01"], ["2026-06-30"], ["2026-07-32"], ["2026-02-30"], ["20260701"]]) {
    expect(() => validateAnalysis({ ...data, edges: [{ ...data.edges[0], dates }, ...data.edges.slice(1)] })).toThrow("повреждён");
  }
  expect(() => validateAnalysis({ ...data, schema_version: 1 })).toThrow("повреждён");
  await page.route("**/analysis.json", (route) => route.fulfill({ json: data }));
  await page.goto("/");
  await page.getByLabel("Область графа").selectOption("path");
  await expect(page.locator(".path-details .chronology-status")).toHaveCount(0);
  await page.getByLabel("Найти узел по gid").fill(ids[2]);
  await page.getByLabel("Найти узел по gid").press("Enter");
  await expect(page.locator(".path-details .chronology-status")).toContainText("Один шаг");
  await expect(page.locator(".path-details li")).toContainText("Дата операции: 2026-07-01");
});
