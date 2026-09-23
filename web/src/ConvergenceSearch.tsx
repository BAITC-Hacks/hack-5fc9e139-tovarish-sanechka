import { useMemo, useState } from "react";
import { labels, number, percent, type Analysis, type Edge } from "./types";
import { PathChronology } from "./PathChronology";

type Parents = Map<string, string | null>;

function shortestPaths(seed: string, adjacency: Map<string, string[]>): Parents {
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

export function ConvergenceSearch({
  data,
  selected,
  onSelect,
}: {
  data: Analysis;
  selected: string;
  onSelect: (gid: string) => void;
}) {
  const [input, setInput] = useState("");
  const [seeds, setSeeds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.gid, node])), [data]);
  const { adjacency, edgeByPair } = useMemo(() => {
    const adjacency = new Map<string, string[]>();
    const edgeByPair = new Map<string, Edge>();
    for (const edge of data.edges) {
      if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
      adjacency.get(edge.src)!.push(edge.dst);
      edgeByPair.set(`${edge.src}:${edge.dst}`, edge);
    }
    for (const targets of adjacency.values())
      targets.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return { adjacency, edgeByPair };
  }, [data]);
  const result = useMemo(() => {
    if (!seeds.length) return null;
    const parents = seeds.map((seed) => shortestPaths(seed, adjacency));
    const candidates = data.top_nodes.filter((item) =>
      !byId.get(item.gid)!.is_seed && parents.every((paths) => paths.has(item.gid)),
    );
    return { parents, candidates };
  }, [seeds, adjacency, data, byId]);
  const active = result?.candidates.find((item) => item.gid === selected);

  return (
    <section className="convergence panel" aria-labelledby="convergence-title">
      <div className="section-head">
        <h2 id="convergence-title">Общие узлы известных клиентов</h2>
        <span>Новые кандидаты для проверки</span>
      </div>
      <form
        className="convergence-form"
        onSubmit={(event) => {
          event.preventDefault();
          const tokens = input.trim().split(/[\s,;]+/).filter(Boolean);
          setSeeds([]);
          setPage(0);
          if (tokens.length < 2 || tokens.length > 5) {
            setError("Укажите от 2 до 5 исходных gid.");
            return;
          }
          if (new Set(tokens).size !== tokens.length) {
            setError("Исходные gid не должны повторяться.");
            return;
          }
          const invalid = tokens.find((gid) => !byId.get(gid)?.is_seed);
          if (invalid) {
            setError(`gid ${invalid} не найден среди исходных узлов.`);
            return;
          }
          setSeeds(tokens);
          setError("");
        }}
      >
        <label htmlFor="source-gids">
          Исходные gid
          <textarea
            id="source-gids"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-describedby="convergence-hint"
            placeholder="2–5 gid через пробел, запятую или новую строку"
            rows={2}
          />
        </label>
        <button type="submit">Найти общие узлы</button>
      </form>
      <p id="convergence-hint" className="muted">
        Ищем клиентов, достижимых по направленным связям от каждого указанного
        исходного узла. Известные исходные клиенты исключены из результата.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div
          className={`convergence-results${result.candidates.length ? "" : " no-candidates"}`}
        >
          <div>
            <p className="result-count" role="status">
              Совпадений: {number(result.candidates.length)}
            </p>
            {result.candidates.length ? (
              <>
                <ul className="candidate-list">
                  {result.candidates.slice(page * 20, page * 20 + 20).map((item) => (
                    <li key={item.gid}>
                      <button
                        aria-pressed={selected === item.gid}
                        onClick={() => onSelect(item.gid)}
                      >
                        <span>№ {item.rank} · {item.gid}</span>
                        <span>{labels[item.role]} · {percent(item.priority_score)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="pagination">
                  <button disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
                  <span>{page + 1} / {Math.ceil(result.candidates.length / 20)}</span>
                  <button
                    disabled={(page + 1) * 20 >= result.candidates.length}
                    onClick={() => setPage(page + 1)}
                  >Далее</button>
                </div>
              </>
            ) : (
              <p className="empty">Общих новых узлов в наблюдаемом графе нет. Попробуйте другую комбинацию исходных gid.</p>
            )}
          </div>
          {active && (
            <div className="convergence-paths">
              <h3>Наблюдаемые пути к {active.gid}</h3>
              {seeds.map((seed, index) => {
                const path = pathTo(result.parents[index], active.gid);
                const edges = path.slice(1).map((dst, step) => {
                  const edge = edgeByPair.get(`${path[step]}:${dst}`);
                  if (!edge) throw new Error("Ребро пути отсутствует в графе");
                  return edge;
                });
                return (
                  <div className="source-path" key={seed}>
                    <strong>От {seed} · шагов: {path.length - 1}</strong>
                    <PathChronology edges={edges} onSelect={onSelect} />
                  </div>
                );
              })}
              <p className="muted">Пути и суммы рёбер не доказывают движение одних и тех же денег.</p>
            </div>
          )}
          {!active && result.candidates.length > 0 && (
            <p className="empty">Выберите узел из списка, чтобы увидеть путь от каждого исходного клиента и открыть его карточку.</p>
          )}
        </div>
      )}
    </section>
  );
}
