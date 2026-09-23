import { test, expect } from "@playwright/test";
import {
  findTemporalPath,
  structuralPath,
  pathEdges,
} from "../src/graphQueries";
import { checkPathChronology } from "../src/PathChronology";
import { type Analysis } from "../src/types";

function graph(
  rows: [string, string, string[]][],
  extra: string[] = [],
): Analysis {
  const ids = [...new Set([...extra, ...rows.flatMap(([a, b]) => [a, b])])];
  return {
    nodes: ids.map((gid) => ({ gid })),
    edges: rows.map(([src, dst, dates]) => ({ src, dst, dates })),
  } as Analysis;
}
const day = (n: number) => `2026-07-${String(n).padStart(2, "0")}`;

test("temporal search keeps arrival dates and prefers strict order over shorter same-day paths", () => {
  const data = graph([
    ["1", "2", [day(1), day(5)]],
    ["2", "4", [day(1)]],
    ["1", "3", [day(2)]],
    ["3", "5", [day(3)]],
    ["5", "4", [day(4)]],
    ["3", "1", [day(3)]],
  ]);
  expect(findTemporalPath(data, "1", "4")).toEqual({
    status: "ordered",
    path: ["1", "3", "5", "4"],
    dates: [day(2), day(3), day(4)],
  });
  const fallback = graph(
    [
      ["1", "2", [day(2)]],
      ["2", "3", [day(2)]],
      ["2", "1", [day(2)]],
    ],
    ["9"],
  );
  expect(findTemporalPath(fallback, "1", "3").status).toBe("same_day");
  expect(findTemporalPath(fallback, "1", "9").status).toBe("not_found");
  expect(findTemporalPath(fallback, "1", "1").path).toEqual(["1"]);
  expect(() => findTemporalPath(fallback, "1", "404")).toThrow();
  const revisit = graph([
    ["1", "2", [day(5)]],
    ["1", "3", [day(1)]],
    ["3", "2", [day(2)]],
    ["2", "4", [day(3)]],
  ]);
  expect(findTemporalPath(revisit, "1", "4").path).toEqual([
    "1",
    "3",
    "2",
    "4",
  ]);
});

test("temporal search minimizes hops, has no four-hop cutoff and is reproducible", () => {
  const data = graph([
    ["1", "2", [day(1)]],
    ["2", "3", [day(2)]],
    ["3", "9", [day(3)]],
    ["1", "4", [day(20)]],
    ["4", "9", [day(21)]],
  ]);
  expect(findTemporalPath(data, "1", "9").path).toEqual(["1", "4", "9"]);
  expect(
    findTemporalPath({ ...data, edges: [...data.edges].reverse() }, "1", "9"),
  ).toEqual(findTemporalPath(data, "1", "9"));
  const ids = Array.from({ length: 7 }, (_, i) => `10000000000000000${i}`);
  const chain = graph(ids.slice(1).map((id, i) => [ids[i], id, [day(i + 1)]]));
  expect(findTemporalPath(chain, ids[0], ids[6]).path).toEqual(ids);
});

test("real-data conflicting route has an ordered alternative and survives browser history", async ({
  page,
  request,
}) => {
  const data: Analysis = await (await request.get("/analysis.json")).json();
  const source = "100000003016635100",
    target = "100000000490383100";
  const original = structuralPath(data, source, target);
  expect(checkPathChronology(pathEdges(data, original)).status).toBe(
    "inconsistent",
  );
  const found = findTemporalPath(data, source, target);
  expect(found.path).toEqual([source, "100000005287097100", target]);
  expect(found.dates).toEqual([day(11), day(19)]);
  await page.goto(`/?selected=${target}&mode=path&path=${original.join(",")}`);
  await page
    .getByRole("button", { name: "Найти путь с согласованными датами" })
    .click();
  await expect(
    page.getByText("Показан маршрут, найденный с учётом дат."),
  ).toBeVisible();
  await expect(
    page.getByText("Последовательность дат согласована", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Вернуться к исходному маршруту" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться к исходному маршруту" })
    .click();
  await expect(
    page.getByText("Выбранный путь не согласован по датам", { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText("Показан маршрут, найденный с учётом дат."),
  ).toBeVisible();
});
