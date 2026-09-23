import { type Analysis, type Edge } from "./types";
import { checkPathChronology } from "./PathChronology";

export const compareGids = (a: string, b: string) =>
  a.length - b.length || a.localeCompare(b);

export function pathEdges(data: Analysis, path: string[]): Edge[] {
  const byPair = new Map(
    data.edges.map((edge) => [`${edge.src}:${edge.dst}`, edge]),
  );
  return path.slice(1).map((dst, i) => {
    const edge = byPair.get(`${path[i]}:${dst}`);
    if (!edge) throw new Error("В маршруте отсутствует направленная связь.");
    return edge;
  });
}

export function structuralPath(
  data: Analysis,
  source: string,
  target: string,
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
    adjacency.get(edge.src)!.push(edge.dst);
  }
  for (const neighbors of adjacency.values()) neighbors.sort(compareGids);
  const parents = shortestPaths(source, adjacency);
  return parents.has(target) ? pathTo(parents, target) : [];
}

export type TemporalPath = {
  status: "ordered" | "same_day" | "not_found";
  path: string[];
  dates: string[];
};

export function findTemporalPath(
  data: Analysis,
  source: string,
  target: string,
): TemporalPath {
  const ids = new Set(data.nodes.map((node) => node.gid));
  if (!ids.has(source) || !ids.has(target))
    throw new Error("Участник отсутствует в текущей выборке.");
  const adjacency = new Map<string, Edge[]>();
  for (const edge of data.edges) {
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
    adjacency.get(edge.src)!.push(edge);
  }
  for (const edges of adjacency.values())
    edges.sort((a, b) => compareGids(a.dst, b.dst));
  for (const strict of [true, false]) {
    const queue = [{ gid: source, day: "", parent: -1 }];
    const seen = new Set([`${source}:`]);
    // BFS over (node, arrival date), not nodes alone: later visits may have
    // different feasible continuations. Every state is processed at most once.
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (current.gid === target) {
        const path: string[] = [],
          dates: string[] = [];
        for (let j = i; j >= 0; j = queue[j].parent) {
          path.push(queue[j].gid);
          if (queue[j].day) dates.push(queue[j].day);
        }
        return {
          status: strict ? "ordered" : "same_day",
          path: path.reverse(),
          dates: dates.reverse(),
        };
      }
      for (const edge of adjacency.get(current.gid) ?? []) {
        for (const day of edge.dates) {
          if (strict ? day <= current.day : day < current.day) continue;
          const key = `${edge.dst}:${day}`;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ gid: edge.dst, day, parent: i });
        }
      }
    }
  }
  return { status: "not_found", path: [], dates: [] };
}

type Parents = Map<string, string | null>;
export function shortestPaths(
  seed: string,
  adjacency: Map<string, string[]>,
): Parents {
  const parents: Parents = new Map([[seed, null]]);
  const pending = [seed];
  for (let index = 0; index < pending.length; index++) {
    for (const next of adjacency.get(pending[index]) ?? []) {
      if (parents.has(next)) continue;
      parents.set(next, pending[index]);
      pending.push(next);
    }
  }
  return parents;
}
export function pathTo(parents: Parents, target: string): string[] {
  const path: string[] = [];
  let current: string | null = target;
  while (current !== null) {
    path.push(current);
    const previous: string | null | undefined = parents.get(current);
    if (previous === undefined) throw new Error("Неполный путь в графе");
    current = previous;
  }
  return path.reverse();
}

export function findCommonCandidates(data: Analysis | null, seeds: string[]) {
  if (
    !data ||
    seeds.length < 2 ||
    seeds.length > 5 ||
    new Set(seeds).size !== seeds.length
  )
    return null;
  const byId = new Map(data.nodes.map((node) => [node.gid, node]));
  if (seeds.some((id) => !byId.get(id)?.is_seed)) return null;
  const adjacency = new Map<string, string[]>();
  const edgeByPair = new Map<string, Edge>();
  for (const edge of data.edges) {
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
    adjacency.get(edge.src)!.push(edge.dst);
    edgeByPair.set(`${edge.src}:${edge.dst}`, edge);
  }
  for (const targets of adjacency.values())
    targets.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const parents = seeds.map((seed) => shortestPaths(seed, adjacency));
  return data.top_nodes
    .filter(
      (item) =>
        !byId.get(item.gid)!.is_seed && parents.every((p) => p.has(item.gid)),
    )
    .map((item) => {
      const paths = parents.map((p) => pathTo(p, item.gid));
      const edges = paths.map((path) =>
        path
          .slice(1)
          .map((dst, step) => edgeByPair.get(`${path[step]}:${dst}`)!),
      );
      const statuses = edges.map((path) => checkPathChronology(path).status);
      return {
        ...item,
        paths,
        edges,
        chronologies: statuses,
        steps: Math.max(...paths.map((p) => p.length - 1)),
        chronology: statuses.includes("inconsistent")
          ? "inconsistent"
          : statuses.includes("same_day")
            ? "same_day"
            : "ordered",
      };
    });
}
export type CommonCandidate = NonNullable<
  ReturnType<typeof findCommonCandidates>
>[number];
