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
}
export interface Edge {
  id: string;
  src: string;
  dst: string;
  sum_kzt: number;
  n_tx: number;
  depth: number;
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
  schema_version: 1;
  meta: {
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
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const numeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const gid = (v: unknown): v is string =>
  typeof v === "string" && /^\d+$/.test(v);
export function validateAnalysis(value: unknown): Analysis {
  const fail = (): never => {
    throw new Error(
      "Файл результатов повреждён или имеет неподдерживаемый формат. Повторите расчёт приложения.",
    );
  };
  if (!object(value) || value.schema_version !== 1 || !object(value.meta))
    return fail();
  for (const key of ["nodes", "edges", "clusters", "top_nodes"])
    if (!Array.isArray(value[key])) return fail();
  const data = value as unknown as Analysis;
  const ids = new Set<string>();
  for (const n of data.nodes) {
    if (
      !object(n) ||
      !gid(n.gid) ||
      ids.has(n.gid) ||
      !roles.includes(n.role) ||
      typeof n.evidence !== "string" ||
      !n.evidence ||
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
    for (const key of [
      "pass_through",
      "in_concentration",
      "out_concentration",
    ] as const)
      if (n[key] !== null && !numeric(n[key])) return fail();
    ids.add(n.gid);
  }
  const edgeIds = new Set<string>();
  for (const e of data.edges) {
    if (
      !object(e) ||
      typeof e.id !== "string" ||
      edgeIds.has(e.id) ||
      !ids.has(e.src) ||
      !ids.has(e.dst) ||
      !numeric(e.sum_kzt) ||
      !numeric(e.n_tx) ||
      !numeric(e.depth)
    )
      return fail();
    edgeIds.add(e.id);
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
  return data;
}
export const number = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
export const percent = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
