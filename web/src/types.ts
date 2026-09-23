export const roles = [
  "consolidator",
  "transit",
  "distributor",
  "terminal",
  "coordinator",
  "peripheral",
] as const;
export type Role = (typeof roles)[number];
export const labels: Record<Role, string> = {
  consolidator: "Консолидация",
  transit: "Транзит",
  distributor: "Распределение",
  terminal: "Удержание",
  coordinator: "Связующий узел",
  peripheral: "Недостаточно оснований",
};
export const colors: Record<Role, string> = {
  consolidator: "#6d4ab1",
  transit: "#247a92",
  distributor: "#2165ac",
  terminal: "#a95b24",
  coordinator: "#b43e60",
  peripheral: "#697987",
};
export interface Node {
  gid: string;
  role: Role;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  pagerank: number;
  pass_through: number | null;
  depth: number;
  is_seed: boolean;
  truncated_by_depth: boolean;
  reachable_seed_count: number;
  data_warnings: string[];
  seed_path_gids: string[];
  next_check: string;
  role_scores: Record<Role, number>;
  betweenness: number;
  neighbor_cluster_count: number;
  active_days: number;
  max_daily_payers: number;
  out_with_recent_in_share: number;
  priority_seed_reach: number;
  priority_structure: number;
  priority_volume: number;
  in_concentration: number | null;
  out_concentration: number | null;
  role_sensitivity: RoleScenario[];
}
export interface RoleScenario {
  scenario: "lower" | "base" | "higher";
  role: Role;
  role_score: number;
  reasons: string[];
}
export interface Edge {
  id: string;
  src: string;
  dst: string;
  sum_kzt: number;
  n_tx: number;
  depth: number;
  dates: string[];
  operations: { index: number; date: string; sum_kzt: number }[];
}
export interface Cluster {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string[];
  hypothesis: string;
}
export interface Analysis {
  schema_version: 3;
  sensitivity: {
    id: RoleScenario["scenario"];
    factor: number;
    thresholds: Record<string, number>;
  }[];
  meta: {
    config: {
      thresholds: Record<string, number>;
      priority_weights: {
        seed_reach: number;
        structure: number;
        volume: number;
      };
    };
    n_nodes: number;
    n_edges: number;
    n_transactions: number;
    period_start: string;
    period_end: string;
    limitations: string[];
  };
  nodes: Node[];
  edges: Edge[];
  clusters: Cluster[];
  top_nodes: {
    rank: number;
    gid: string;
    role: Role;
    priority_score: number;
    why: string;
  }[];
  resilience: {
    baseline_largest_component: number;
    random_seed: number;
    random_draws: number;
    scenarios: {
      removed_count: number;
      removed_priority_gids: string[];
      largest_after_priority: number;
      components_after_priority: number;
      largest_after_degree: number;
      random_median_largest: number;
    }[];
  };
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const numeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const gid = (v: unknown): v is string =>
  typeof v === "string" && /^\d+$/.test(v);
const calendarDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const timestamp = Date.parse(`${v}T00:00:00Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === v
  );
};
export function validateAnalysis(value: unknown): Analysis {
  const fail = (): never => {
    throw new Error(
      "Файл результатов повреждён или имеет неподдерживаемый формат. Повторите расчёт приложения.",
    );
  };
  if (!object(value) || value.schema_version !== 3 || !object(value.meta))
    return fail();
  const config = value.meta.config;
  if (
    !object(config) ||
    !object(config.thresholds) ||
    !object(config.priority_weights)
  )
    return fail();
  for (const key of [
    "min_payers",
    "min_recipients",
    "min_volume",
    "min_seed_reach",
    "coordinator_seed_reach",
    "min_neighbor_clusters",
    "min_betweenness",
    "max_concentration",
    "transit_ratio_min",
    "transit_ratio_max",
    "min_recent_in_share",
    "terminal_ratio_max",
  ])
    if (!numeric(config.thresholds[key]) || config.thresholds[key] < 0)
      return fail();
  for (const key of ["seed_reach", "structure", "volume"])
    if (
      !numeric(config.priority_weights[key]) ||
      config.priority_weights[key] < 0
    )
      return fail();
  if (
    !calendarDate(value.meta.period_start) ||
    !calendarDate(value.meta.period_end) ||
    value.meta.period_start > value.meta.period_end
  )
    return fail();
  for (const key of ["nodes", "edges", "clusters", "top_nodes"])
    if (!Array.isArray(value[key])) return fail();
  const data = value as unknown as Analysis;
  const scenarioIds = ["lower", "base", "higher"];
  const varied = ["min_payers", "min_recipients", "min_volume", "coordinator_seed_reach", "min_neighbor_clusters", "min_betweenness"];
  if (!Array.isArray(data.sensitivity) || data.sensitivity.length !== 3) return fail();
  for (const [i, s] of data.sensitivity.entries()) {
    const factor = [0.9, 1, 1.1][i];
    if (!object(s) || s.id !== scenarioIds[i] || s.factor !== factor || !object(s.thresholds)) return fail();
    for (const [key, v] of Object.entries(data.meta.config.thresholds)) {
      const expected = v * (varied.includes(key) ? factor : 1);
      if (!numeric(s.thresholds[key]) || Math.abs(s.thresholds[key] - expected) > 1e-12 * Math.max(1, expected)) return fail();
    }
  }
  const ids = new Set<string>();
  for (const n of data.nodes) {
    if (
      !object(n) ||
      !gid(n.gid) ||
      ids.has(n.gid) ||
      !roles.includes(n.role) ||
      typeof n.evidence !== "string" ||
      !n.evidence ||
      typeof n.next_check !== "string" ||
      !n.next_check ||
      !Array.isArray(n.seed_path_gids) ||
      !n.seed_path_gids.every(gid) ||
      !Array.isArray(n.data_warnings) ||
      !n.data_warnings.every((x) => typeof x === "string")
    )
      return fail();
    for (const key of [
      "role_score",
      "priority_score",
      "cluster_id",
      "in_deg",
      "out_deg",
      "in_kzt",
      "out_kzt",
      "in_tx",
      "out_tx",
      "pagerank",
      "depth",
      "reachable_seed_count",
      "betweenness",
      "neighbor_cluster_count",
      "active_days",
      "max_daily_payers",
      "out_with_recent_in_share",
      "priority_seed_reach",
      "priority_structure",
      "priority_volume",
    ] as const)
      if (!numeric(n[key])) return fail();
    if (
      n.role_score < 0 ||
      n.role_score > 1 ||
      n.priority_score < 0 ||
      n.priority_score > 1 ||
      typeof n.is_seed !== "boolean" ||
      typeof n.truncated_by_depth !== "boolean" ||
      !object(n.role_scores)
    )
      return fail();
    for (const role of roles) if (!numeric(n.role_scores[role])) return fail();
    if (!Array.isArray(n.role_sensitivity) || n.role_sensitivity.length !== 3) return fail();
    for (const [i, s] of n.role_sensitivity.entries())
      if (!object(s) || s.scenario !== scenarioIds[i] || !roles.includes(s.role) || !numeric(s.role_score)
          || s.role_score < 0 || s.role_score > 1 || !Array.isArray(s.reasons) || !s.reasons.length
          || !s.reasons.every((r) => typeof r === "string" && r.length > 0)) return fail();
    if (n.role_sensitivity[1].role !== n.role || Math.abs(n.role_sensitivity[1].role_score - n.role_score) > 1e-12) return fail();
    for (const key of [
      "pass_through",
      "in_concentration",
      "out_concentration",
    ] as const)
      if (n[key] !== null && !numeric(n[key])) return fail();
    ids.add(n.gid);
  }
  const edgeIds = new Set<string>();
  const operationIds = new Set<number>();
  for (const e of data.edges) {
    if (
      !object(e) ||
      typeof e.id !== "string" ||
      edgeIds.has(e.id) ||
      !ids.has(e.src) ||
      !ids.has(e.dst) ||
      !numeric(e.sum_kzt) ||
      !numeric(e.n_tx) ||
      !numeric(e.depth) ||
      !Array.isArray(e.dates) ||
      !e.dates.length ||
      !e.dates.every(
        (day, index) =>
          calendarDate(day) &&
          day >= data.meta.period_start &&
          day <= data.meta.period_end &&
          (index === 0 || e.dates[index - 1] < day),
      )
    )
      return fail();
    if (!Array.isArray(e.operations) || e.operations.length !== e.n_tx) return fail();
    for (const op of e.operations) {
      if (!object(op) || !Number.isSafeInteger(op.index) || op.index < 0 || operationIds.has(op.index)
          || !e.dates.includes(op.date) || !numeric(op.sum_kzt) || op.sum_kzt < 5000) return fail();
      operationIds.add(op.index);
    }
    const total = e.operations.reduce((sum, op) => sum + op.sum_kzt, 0);
    if (Math.abs(total - e.sum_kzt) > 0.01 + Math.abs(e.sum_kzt) * 1e-10
        || new Set(e.operations.map((op) => op.date)).size !== e.dates.length) return fail();
    edgeIds.add(e.id);
  }
  if (operationIds.size !== data.meta.n_transactions || [...operationIds].some((id) => id >= operationIds.size)) return fail();
  const edgePairs = new Set(data.edges.map((e) => `${e.src}:${e.dst}`));
  const seeds = new Set(data.nodes.filter((n) => n.is_seed).map((n) => n.gid));
  for (const n of data.nodes) {
    const path = n.seed_path_gids;
    if (!path.length) {
      if (n.is_seed || n.reachable_seed_count > 0) return fail();
      continue;
    }
    if (path.at(-1) !== n.gid || !seeds.has(path[0])) return fail();
    if (path.length === 1 && !n.is_seed) return fail();
    for (let i = 1; i < path.length; i++)
      if (!edgePairs.has(`${path[i - 1]}:${path[i]}`)) return fail();
  }
  const clusters = new Set<number>();
  for (const c of data.clusters) {
    if (
      !object(c) ||
      !numeric(c.cluster_id) ||
      clusters.has(c.cluster_id) ||
      !numeric(c.n_nodes) ||
      !numeric(c.n_seed) ||
      !numeric(c.sum_kzt_internal) ||
      typeof c.hypothesis !== "string" ||
      !Array.isArray(c.top_gids) ||
      !c.top_gids.every((g) => ids.has(g))
    )
      return fail();
    clusters.add(c.cluster_id);
  }
  if (
    data.nodes.some((n) => !clusters.has(n.cluster_id)) ||
    data.meta.n_nodes !== data.nodes.length ||
    data.meta.n_edges !== data.edges.length ||
    !numeric(data.meta.n_transactions) ||
    !Array.isArray(data.meta.limitations) ||
    !data.meta.limitations.every((x) => typeof x === "string") ||
    typeof data.meta.period_start !== "string" ||
    typeof data.meta.period_end !== "string"
  )
    return fail();
  const topIds = new Set<string>();
  for (const [i, t] of data.top_nodes.entries()) {
    if (
      !object(t) ||
      !ids.has(t.gid) ||
      topIds.has(t.gid) ||
      t.rank !== i + 1 ||
      !roles.includes(t.role) ||
      !numeric(t.priority_score) ||
      typeof t.why !== "string"
    )
      return fail();
    topIds.add(t.gid);
  }
  if (ids.size === 0 || topIds.size !== ids.size) return fail();
  const resilience = data.resilience;
  if (
    !object(resilience) ||
    !numeric(resilience.baseline_largest_component) ||
    resilience.baseline_largest_component < 1 ||
    !numeric(resilience.random_seed) ||
    !numeric(resilience.random_draws) ||
    resilience.random_draws < 1 ||
    !Array.isArray(resilience.scenarios)
  )
    return fail();
  for (const scenario of resilience.scenarios) {
    if (
      !object(scenario) ||
      !numeric(scenario.removed_count) ||
      scenario.removed_count < 1 ||
      !Array.isArray(scenario.removed_priority_gids) ||
      scenario.removed_priority_gids.length !== scenario.removed_count ||
      !scenario.removed_priority_gids.every((id) => ids.has(id)) ||
      !numeric(scenario.largest_after_priority) ||
      !numeric(scenario.components_after_priority) ||
      !numeric(scenario.largest_after_degree) ||
      !numeric(scenario.random_median_largest)
    )
      return fail();
  }
  return data;
}
export const number = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
export const percent = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
export const points = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n * 100);

export function readable(text: string) {
  let result = text
    .replace(/; (граница depth=4|вход seed неполон|выборка неполна)/g, "")
    .replaceAll("depth=4", "четырёх шагов")
    .replaceAll("seed=", "исходных клиентов: ")
    .replaceAll("seed", "исходных клиентов")
    .replaceAll("внеш. кластеров", "соседних групп")
    .replaceAll("посредничество", "участие в кратчайших маршрутах")
    .replaceAll(
      "близость ≤2д",
      "отправлено в течение двух дней после поступления",
    )
    .replaceAll(
      "не трассировка",
      "совпадение дат не подтверждает перевод той же суммы",
    );
  for (const role of roles)
    result = result.replaceAll(role, labels[role].toLowerCase());
  return result;
}
