import { useMemo, useState } from "react";
import {
  labels,
  number,
  points,
  roles,
  type Analysis,
  type Edge,
} from "./types";
import { checkPathChronology } from "./PathChronology";
import { Pagination } from "./Pagination";
import { type Workspace } from "./workspace";

type Parents = Map<string, string | null>;
function shortestPaths(
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
function pathTo(parents: Parents, target: string): string[] {
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

export function useConvergence(data: Analysis | null, seeds: string[]) {
  return useMemo(() => {
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
  }, [data, seeds.join(",")]);
}
export type CommonCandidate = NonNullable<
  ReturnType<typeof useConvergence>
>[number];
export function filterCandidates(
  result: CommonCandidate[] | null,
  state: Workspace,
) {
  return (
    result?.filter(
      (item) =>
        (!state.candidateRole || item.role === state.candidateRole) &&
        (!state.steps || item.steps <= state.steps) &&
        (!state.chronology || item.chronology === state.chronology),
    ) ?? []
  );
}

export function ConvergenceSearch({
  data,
  state,
  update,
  result,
  onSelect,
  onExport,
}: {
  data: Analysis;
  state: Workspace;
  update: (patch: Partial<Workspace>) => void;
  result: CommonCandidate[] | null;
  onSelect: (gid: string) => void;
  onExport: (ids: string[]) => void;
}) {
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const tokens = state.sourceInput
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  const dirty = result !== null && tokens.join(",") !== state.seeds.join(",");
  const filtered = filterCandidates(result, state);
  const page = Math.min(
    state.candidatePage,
    Math.max(0, Math.ceil(filtered.length / state.candidateSize) - 1),
  );
  function addSource(id: string) {
    if (!id) return;
    if (tokens.includes(id)) {
      setError("Этот клиент уже добавлен.");
      return;
    }
    if (tokens.length >= 5) {
      setError("Можно выбрать не более 5 исходных клиентов.");
      return;
    }
    update({ sourceInput: [...tokens, id].join(", ") });
    setError("");
  }
  return (
    <section className="convergence" aria-labelledby="convergence-title">
      <div className="section-head">
        <h2 id="convergence-title">Общие узлы</h2>
        <button onClick={() => update({ list: "priority" })}>
          Свернуть поиск
        </button>
      </div>
      <p className="muted">
        Новые участники, достижимые от каждого из 2–5 известных клиентов.
        Фильтры ниже относятся только к этому поиску.
      </p>
      <form
        className="convergence-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (tokens.length < 2 || tokens.length > 5) {
            setError("Укажите от 2 до 5 исходных gid.");
            return;
          }
          if (new Set(tokens).size !== tokens.length) {
            setError("Исходные gid не должны повторяться.");
            return;
          }
          const invalid = tokens.find(
            (id) => !data.nodes.some((n) => n.gid === id && n.is_seed),
          );
          if (invalid) {
            setError(`gid ${invalid} не найден среди исходных узлов.`);
            return;
          }
          update({ seeds: tokens, candidatePage: 0 });
          setError("");
        }}
      >
        <label htmlFor="source-gids">
          Исходные gid
          <textarea
            id="source-gids"
            value={state.sourceInput}
            onChange={(event) => update({ sourceInput: event.target.value })}
            rows={2}
            placeholder="2–5 идентификаторов через запятую"
          />
        </label>
        <button type="submit">Найти общие узлы</button>
      </form>
      <details className="source-picker">
        <summary>Добавить исходного клиента</summary>
        <label>
          Выбор исходного клиента
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Выберите клиента</option>
            {data.nodes
              .filter((n) => n.is_seed)
              .map((n) => (
                <option key={n.gid} value={n.gid}>
                  {n.gid} · {labels[n.role]}
                </option>
              ))}
          </select>
        </label>
        <button disabled={!source} onClick={() => addSource(source)}>
          Добавить в запрос
        </button>
        <button
          disabled={
            !data.nodes.some((n) => n.gid === state.selected && n.is_seed)
          }
          onClick={() => addSource(state.selected)}
        >
          Добавить открытого клиента
        </button>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {dirty && (
        <p className="stale-notice" role="status">
          Запрос изменён, выполните поиск повторно. Ниже сохранён предыдущий
          результат.
        </p>
      )}
      {result !== null && (
        <div className="convergence-results">
          <p className="muted result-sources">
            Результат для: {state.seeds.join(", ")}
          </p>
          <div className="filters">
            <label>
              Основная роль кандидата
              <select
                value={state.candidateRole}
                onChange={(event) =>
                  update({
                    candidateRole: event.target.value,
                    candidatePage: 0,
                  })
                }
              >
                <option value="">Все роли</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {labels[role]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Не больше шагов
              <input
                type="number"
                min={0}
                max={data.nodes.length}
                value={state.steps}
                onChange={(event) =>
                  update({
                    steps: Math.max(0, event.target.valueAsNumber || 0),
                    candidatePage: 0,
                  })
                }
              />
            </label>
            <label>
              Даты маршрутов
              <select
                value={state.chronology}
                onChange={(event) =>
                  update({ chronology: event.target.value, candidatePage: 0 })
                }
              >
                <option value="">Любые</option>
                <option value="ordered">Все согласованы</option>
                <option value="same_day">
                  Есть порядок внутри дня неизвестен
                </option>
                <option value="inconsistent">Есть конфликт дат</option>
              </select>
            </label>
          </div>
          <p className="muted">
            0 шагов — без ограничения. Даты проверены для выбранных кратчайших
            маршрутов.
          </p>
          <p className="result-count" role="status">
            Совпадений: {number(filtered.length)} из {number(result.length)}
          </p>
          <button
            disabled={!filtered.length}
            onClick={() => onExport(filtered.map((item) => item.gid))}
          >
            Выгрузить кандидатов ({filtered.length})
          </button>
          {filtered.length ? (
            <>
              <ul className="candidate-list">
                {filtered
                  .slice(
                    page * state.candidateSize,
                    (page + 1) * state.candidateSize,
                  )
                  .map((item) => (
                    <li key={item.gid}>
                      <button
                        aria-pressed={state.selected === item.gid}
                        onClick={() => onSelect(item.gid)}
                      >
                        <span>
                          № {item.rank} · {item.gid}
                        </span>
                        <span>
                          {labels[item.role]} · {points(item.priority_score)}{" "}
                          балла · до {item.steps} шагов
                        </span>
                        <span>
                          {item.chronology === "ordered"
                            ? "Даты согласованы"
                            : item.chronology === "same_day"
                              ? "Порядок внутри дня неизвестен"
                              : "Есть конфликт дат"}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              <Pagination
                count={filtered.length}
                page={page}
                size={state.candidateSize}
                onChange={(candidatePage, candidateSize) =>
                  update({ candidatePage, candidateSize })
                }
              />
            </>
          ) : (
            <p className="empty">
              {result.length
                ? "Нет кандидатов с такими фильтрами."
                : "Общих новых узлов в наблюдаемом графе нет. Попробуйте другую комбинацию исходных gid."}
              {result.length > 0 && (
                <button
                  onClick={() =>
                    update({
                      candidateRole: "",
                      steps: 0,
                      chronology: "",
                      candidatePage: 0,
                    })
                  }
                >
                  Сбросить фильтры кандидатов
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
