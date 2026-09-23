import { useEffect, useState } from "react";
import { labels, type Node } from "./types";

export const initialWorkspace = {
  selected: "",
  query: "",
  role: "",
  cluster: "",
  clusterQuery: "",
  selection: "new",
  page: 0,
  pageSize: 10,
  descending: true,
  mode: "neighbors",
  path: [] as string[],
  expanded: false,
  list: "priority",
  pane: "list",
  sourceInput: "",
  seeds: [] as string[],
  candidateRole: "",
  steps: 0,
  chronology: "",
  candidatePage: 0,
  candidateSize: 10,
};
export type Workspace = typeof initialWorkspace;

function readWorkspace(): Workspace {
  const params = new URLSearchParams(location.search);
  const state = { ...initialWorkspace };
  for (const key of Object.keys(state) as (keyof Workspace)[]) {
    const raw = params.get(key);
    if (raw === null) continue;
    const fallback = initialWorkspace[key];
    let value: string | number | boolean | string[] = raw;
    if (Array.isArray(fallback))
      value = raw.split(",").filter((id) => /^\d+$/.test(id));
    else if (typeof fallback === "boolean") value = raw === "true";
    else if (typeof fallback === "number")
      value = /^\d+$/.test(raw) ? Math.min(Number(raw), 100000) : fallback;
    Object.assign(state, { [key]: value });
  }
  if (!["all", "new", "consolidation", "shortlist"].includes(state.selection))
    state.selection = "new";
  if (!["neighbors", "cluster", "path"].includes(state.mode))
    state.mode = "neighbors";
  if (!["list", "details", "network"].includes(state.pane)) state.pane = "list";
  if (!["priority", "common"].includes(state.list)) state.list = "priority";
  for (const key of ["pageSize", "candidateSize"] as const)
    if (![10, 20, 50].includes(state[key])) state[key] = 10;
  return state;
}

export function useWorkspace() {
  const [state, setState] = useState(readWorkspace);
  useEffect(() => {
    const restore = () => setState(readWorkspace());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function update(patch: Partial<Workspace>, push = false) {
    // Read the URL so two updates in the same event cannot overwrite each other.
    const next = { ...readWorkspace(), ...patch };
    const url = new URL(location.href);
    for (const key of Object.keys(next) as (keyof Workspace)[]) {
      const value = next[key];
      if (String(value) === String(initialWorkspace[key]))
        url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    if (url.href !== location.href)
      window.history[push ? "pushState" : "replaceState"]({}, "", url);
    setState(next);
  }
  return [state, update] as const;
}

export interface Decision {
  included: boolean;
  note: string;
}
export type Decisions = Record<string, Decision>;

export function exportCandidates(
  nodes: Node[],
  ranks: Map<string, number>,
  decisions: Decisions,
  name: string,
) {
  // Quote every field and neutralize formula prefixes in analyst-authored notes.
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    [
      "gid",
      "Место",
      "Основная роль",
      "Приоритет, баллы из 100",
      "Исходный клиент",
      "Включён в проверку",
      "Заметка",
    ],
    ...nodes.map((node) => [
      node.gid,
      ranks.get(node.gid) ?? "",
      labels[node.role],
      (node.priority_score * 100).toFixed(1),
      node.is_seed ? "Да" : "Нет",
      decisions[node.gid]?.included ? "Да" : "Нет",
      decisions[node.gid]?.note ?? "",
    ]),
  ];
  const blob = new Blob(
    ["\uFEFF", rows.map((row) => row.map(cell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
