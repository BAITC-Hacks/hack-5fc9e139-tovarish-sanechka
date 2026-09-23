import { useEffect, useMemo, useState } from "react";
import { GraphView } from "./GraphView";
import { ConvergenceSearch } from "./ConvergenceSearch";
import {
  validateAnalysis,
  labels,
  colors,
  roles,
  number,
  percent,
  type Analysis,
  type Node,
  type Role,
} from "./types";

const warnings: Record<string, string> = {
  seed_incomplete_incoming:
    "Входящие исходного узла неполны. Баланс не используется для роли.",
  depth_boundary: "Граница 4-го колена: дальнейшие переводы неизвестны.",
  no_observed_transfers: "Изолированный узел: в выборке нет переводов.",
  sample_incomplete: "Только наблюдаемые операции внутри выборки.",
};
type GraphMode = "neighbors" | "cluster" | "path";
function Badge({ role }: { role: Role }) {
  return (
    <span className="badge">
      <i style={{ background: colors[role] }} />
      {labels[role]}
    </span>
  );
}
function Details({
  node,
  data,
  onSelect,
}: {
  node: Node;
  data: Analysis;
  onSelect: (id: string) => void;
}) {
  const cluster = data.clusters.find((c) => c.cluster_id === node.cluster_id)!;
  const rank = data.top_nodes.find((item) => item.gid === node.gid)!.rank;
  return (
    <section className="details panel" aria-labelledby="node-title">
      <div className="section-head">
        <h2 id="node-title">Карточка узла</h2>
        <span>Кластер {node.cluster_id}</span>
      </div>
      <div className="node-id">{node.gid}</div>
      <Badge role={node.role} />
      <p className="evidence">{node.evidence}</p>
      <div className="flow">
        <div>
          <span>Получено</span>
          <strong>{number(node.in_kzt)} ₸</strong>
          <small>
            {node.in_deg} плательщиков · {node.in_tx} операций
          </small>
        </div>
        <b aria-hidden="true">→</b>
        <div>
          <span>Отправлено</span>
          <strong>{number(node.out_kzt)} ₸</strong>
          <small>
            {node.out_deg} получателей · {node.out_tx} операций
          </small>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Место в приоритете</dt>
          <dd>№ {rank} из {number(data.nodes.length)}</dd>
        </div>
        <div>
          <dt>Приоритет проверки</dt>
          <dd>{percent(node.priority_score)}</dd>
        </div>
        <div>
          <dt>Выраженность роли</dt>
          <dd>{percent(node.role_score)}</dd>
        </div>
        <div>
          <dt>Достижимых исходных узлов</dt>
          <dd>{node.reachable_seed_count}</dd>
        </div>
        <div>
          <dt>Колено обхода</dt>
          <dd>
            {node.depth}
            {node.is_seed ? " · исходный узел" : ""}
          </dd>
        </div>
      </dl>
      <div className="priority-parts">
        <strong>Вклад в приоритет</strong>
        <dl>
          <div><dt>Охват</dt><dd>{percent(node.priority_seed_reach)}</dd></div>
          <div><dt>Структура</dt><dd>{percent(node.priority_structure)}</dd></div>
          <div><dt>Оборот</dt><dd>{percent(node.priority_volume)}</dd></div>
        </dl>
      </div>
      <ul className="warnings">
        {node.data_warnings.map((w) => (
          <li key={w}>{warnings[w] ?? w}</li>
        ))}
      </ul>
      <div className="next-check">
        <strong>Следующий запрос</strong>
        <p>{node.next_check}</p>
      </div>
      <details>
        <summary>Все признаки и альтернативные роли</summary>
        <dl className="facts">
          <div>
            <dt>Выход / вход</dt>
            <dd>
              {node.pass_through === null
                ? "Не определено"
                : node.pass_through.toFixed(3)}
            </dd>
          </div>
          <div>
            <dt>Выход в течение 0–2 дней после входа</dt>
            <dd>{percent(node.out_with_recent_in_share)}</dd>
          </div>
          <div>
            <dt>Активных дней</dt>
            <dd>{node.active_days}</dd>
          </div>
          <div>
            <dt>Максимум плательщиков за день</dt>
            <dd>{node.max_daily_payers}</dd>
          </div>
          <div>
            <dt>Доля крупнейшего плательщика</dt>
            <dd>
              {node.in_concentration === null
                ? "Не определено"
                : percent(node.in_concentration)}
            </dd>
          </div>
          <div>
            <dt>Доля крупнейшего получателя</dt>
            <dd>
              {node.out_concentration === null
                ? "Не определено"
                : percent(node.out_concentration)}
            </dd>
          </div>
          <div>
            <dt>PageRank</dt>
            <dd>{node.pagerank.toFixed(6)}</dd>
          </div>
          <div>
            <dt>Посредничество</dt>
            <dd>{node.betweenness.toFixed(6)}</dd>
          </div>
          <div>
            <dt>Внешних соседних кластеров</dt>
            <dd>{node.neighbor_cluster_count}</dd>
          </div>
          {roles.map((role) => (
            <div key={role}>
              <dt>{labels[role]}</dt>
              <dd>{percent(node.role_scores[role])}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Скоры эвристические, не вероятности. Близость дат не доказывает
          движение тех же денег.
        </p>
      </details>
      <details>
        <summary>
          Кластер {cluster.cluster_id} · {cluster.n_nodes} узлов
        </summary>
        <p>{cluster.hypothesis}</p>
        <p>Лидеры для проверки:</p>
        {cluster.top_gids.map((id) => (
          <button className="link-button" key={id} onClick={() => onSelect(id)}>
            {id}
          </button>
        ))}
      </details>
    </section>
  );
}
export default function App() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState("");
  const [cluster, setCluster] = useState("");
  const [page, setPage] = useState(0);
  const [descending, setDescending] = useState(true);
  const [mode, setMode] = useState<GraphMode>("neighbors");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setData(null);
    fetch("/analysis.json", { signal: abort.signal, cache: "no-store" })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            `Не удалось загрузить результаты (${r.status}). Проверьте готовность приложения.`,
          );
        return r.json();
      })
      .then(validateAnalysis)
      .then((value) => {
        setData(value);
        setSelected(value.top_nodes[0].gid);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить результаты.",
          );
      });
    return () => abort.abort();
  }, [attempt]);
  const byId = useMemo(
    () => new Map(data?.nodes.map((n) => [n.gid, n])),
    [data],
  );
  const node = byId.get(selected);
  const rows = useMemo(
    () =>
      data?.top_nodes
        .map((t) => byId.get(t.gid)!)
        .filter(
          (n) =>
            (!role || n.role === role) &&
            (!cluster || String(n.cluster_id) === cluster),
        ) ?? [],
    [data, byId, role, cluster],
  );
  const sorted = useMemo(
    () => (descending ? rows : [...rows].reverse()),
    [rows, descending],
  );
  const graphData = useMemo(() => {
    if (!data || !node)
      return { nodes: [], edges: [], total: 0, totalEdges: 0 };
    if (mode === "path") {
      const path = node.seed_path_gids;
      const nodes = path.length ? path.map((id) => byId.get(id)!) : [node];
      const edges = path.slice(1).map(
        (id, index) =>
          data.edges.find((edge) => edge.src === path[index] && edge.dst === id)!,
      );
      return { nodes, edges, total: nodes.length, totalEdges: edges.length };
    }
    const ids = new Set<string>([node.gid]);
    if (mode === "cluster")
      data.nodes
        .filter((n) => n.cluster_id === node.cluster_id)
        .forEach((n) => ids.add(n.gid));
    else
      data.edges.forEach((e) => {
        if (e.src === node.gid) ids.add(e.dst);
        if (e.dst === node.gid) ids.add(e.src);
      });
    const candidates = [
      node,
      ...data.nodes
        .filter((n) => n.gid !== node.gid && ids.has(n.gid))
        .sort((a, b) => b.priority_score - a.priority_score),
    ];
    const nodes = expanded ? candidates : candidates.slice(0, 80);
    const visible = new Set(nodes.map((n) => n.gid));
    const allEdges = data.edges.filter((e) => ids.has(e.src) && ids.has(e.dst));
    return {
      nodes,
      edges: allEdges.filter((e) => visible.has(e.src) && visible.has(e.dst)),
      total: ids.size,
      totalEdges: allEdges.length,
    };
  }, [data, node, mode, expanded, byId]);
  const connections = useMemo(
    () =>
      data?.edges.filter((e) => e.src === selected || e.dst === selected) ?? [],
    [data, selected],
  );
  function choose(id: string) {
    setSelected(id);
    setNotice("");
    setExpanded(false);
  }
  if (error)
    return (
      <main className="state panel" role="alert">
        <h1>Результаты недоступны</h1>
        <p>{error}</p>
        <button onClick={() => setAttempt((a) => a + 1)}>
          Повторить загрузку
        </button>
      </main>
    );
  if (!data || !node)
    return (
      <main className="state panel" role="status">
        <h1>Граф денег</h1>
        <p>Загружаем результаты анализа…</p>
      </main>
    );
  return (
    <main>
      <header>
        <div>
          <div className="eyebrow">HackAlem · финансовая сеть</div>
          <h1>Граф денег</h1>
        </div>
        <div className="period">
          Июль 2026
          <span>
            {number(data.meta.n_nodes)} узлов · {number(data.meta.n_edges)}{" "}
            связей · {number(data.meta.n_transactions)} операций
          </span>
        </div>
      </header>
      <div className="caution">
        Роли — гипотезы для проверки. Приоритет не означает виновность.
      </div>
      <form
        className="search panel"
        onSubmit={(event) => {
          event.preventDefault();
          const id = query.trim();
          if (byId.has(id)) {
            choose(id);
            setNotice(
              `Найден узел ${id}. Поиск охватывает все узлы независимо от фильтров.`,
            );
          } else
            setNotice(
              `Узел ${id || "с указанным gid"} не найден. Проверьте идентификатор.`,
            );
        }}
      >
        <label htmlFor="gid">Найти узел по gid</label>
        <input
          id="gid"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Полный идентификатор"
          inputMode="numeric"
          autoComplete="off"
        />
        <button type="submit">Найти</button>
        <p role="status">{notice}</p>
      </form>
      <ConvergenceSearch data={data} selected={selected} onSelect={choose} />
      <div className="workspace">
        <section className="list panel" aria-labelledby="priority-title">
          <div className="section-head">
            <h2 id="priority-title">Приоритеты проверки</h2>
            <span>{rows.length} узлов</span>
          </div>
          <div className="filters">
            <label>
              Роль
              <select
                aria-label="Роль"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Все роли</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Кластер
              <select
                aria-label="Кластер"
                value={cluster}
                onChange={(e) => {
                  setCluster(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Все кластеры</option>
                {data.clusters.map((c) => (
                  <option key={c.cluster_id} value={c.cluster_id}>
                    {c.cluster_id} · {c.n_nodes} узлов
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setRole("");
                setCluster("");
                setPage(0);
              }}
            >
              Сбросить
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>gid / гипотеза роли</th>
                  <th aria-sort={descending ? "descending" : "ascending"}>
                    <button
                      onClick={() => {
                        setDescending((v) => !v);
                        setPage(0);
                      }}
                    >
                      Приоритет {descending ? "↓" : "↑"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(page * 20, page * 20 + 20).map((n) => (
                  <tr
                    key={n.gid}
                    className={n.gid === selected ? "selected" : ""}
                  >
                    <td>
                      <button
                        className="gid-button"
                        aria-pressed={n.gid === selected}
                        onClick={() => choose(n.gid)}
                      >
                        {n.gid}
                      </button>
                      <Badge role={n.role} />
                    </td>
                    <td>
                      <strong>{percent(n.priority_score)}</strong>
                      <div className="score-bar">
                        <span style={{ width: `${n.priority_score * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <p className="empty">
              Нет узлов с такими фильтрами. Сбросьте фильтры, чтобы увидеть все
              узлы.
            </p>
          ) : (
            <div className="pagination">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </button>
              <span>
                {page + 1} / {Math.ceil(rows.length / 20)}
              </span>
              <button
                disabled={(page + 1) * 20 >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </button>
            </div>
          )}
        </section>
        <Details node={node} data={data} onSelect={choose} />
        <section className="network panel" aria-labelledby="graph-title">
          <div className="section-head">
            <h2 id="graph-title">Связи узла</h2>
            <label>
              Область
              <select
                aria-label="Область графа"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as GraphMode);
                  setExpanded(false);
                }}
              >
                <option value="neighbors">Окружение · 1 шаг</option>
                <option value="cluster">Кластер</option>
                <option value="path">Путь от исходного</option>
              </select>
            </label>
          </div>
          <p className="muted">
            Стрелка: отправитель → получатель. Подписи — последние 8 цифр gid.
          </p>
          <GraphView
            nodes={graphData.nodes}
            edges={graphData.edges}
            selected={selected}
            pathMode={mode === "path"}
            onSelect={choose}
          />
          <div className="graph-status">
            Показано {graphData.nodes.length} из {graphData.total} узлов ·{" "}
            {graphData.edges.length} из {graphData.totalEdges} связей
            {graphData.total > graphData.nodes.length && (
              <button onClick={() => setExpanded(true)}>Показать всё</button>
            )}
          </div>
          {mode === "path" && (
            <div className="path-details">
              <h3>Наблюдаемый путь от исходного узла</h3>
              {graphData.edges.length ? (
                <ol>
                  {graphData.edges.map((edge) => (
                    <li key={edge.id}>
                      <span className="path-step">
                        <button className="link-button" onClick={() => choose(edge.src)}>
                          {edge.src}
                        </button>
                        <span aria-hidden="true">→</span>
                        <button className="link-button" onClick={() => choose(edge.dst)}>
                          {edge.dst}
                        </button>
                      </span>
                      <span>{number(edge.sum_kzt)} ₸ · {edge.n_tx} операций</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">
                  {node.is_seed
                    ? "Это исходный узел. Путь от другого исходного узла в выборке не найден."
                    : "Направленный путь от исходного узла в выборке не найден."}
                </p>
              )}
              <p className="muted">
                Суммы агрегированы за июль. Путь по рёбрам не доказывает движение
                одних и тех же денег.
              </p>
            </div>
          )}
          {connections.length === 0 && (
            <p className="empty">
              Изолированный узел. В выборке нет входящих и исходящих переводов.
            </p>
          )}
          <div className="legend">
            {roles.map((r) => (
              <Badge key={r} role={r} />
            ))}
          </div>
          <details className="connections">
            <summary>
              Все переводы выбранного узла · {connections.length} связей
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Направление / контрагент</th>
                    <th>Сумма, ₸</th>
                    <th>Операций</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.src === selected ? "→ Отправлено" : "← Получено"}
                        <button
                          className="link-button"
                          onClick={() =>
                            choose(e.src === selected ? e.dst : e.src)
                          }
                        >
                          {e.src === selected ? e.dst : e.src}
                        </button>
                      </td>
                      <td>{number(e.sum_kzt)}</td>
                      <td>{e.n_tx}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
      <footer className="panel">
        <div>
          <h2>Выгрузки анализа</h2>
          <p className="muted">
            Все узлы, кластеры и приоритеты текущего расчёта.
          </p>
        </div>
        <nav aria-label="Скачать результаты">
          {["nodes_roles", "clusters", "top_nodes"].map((name) => (
            <a key={name} href={`/${name}.csv`} download>
              {name}.csv ↓
            </a>
          ))}
        </nav>
        <details>
          <summary>Ограничения выборки</summary>
          <ul>
            {data.meta.limitations.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </details>
        <details className="resilience">
          <summary>Устойчивость наблюдаемой сети</summary>
          <p>
            Крупнейшая исходная компонента: {number(data.resilience.baseline_largest_component)} узлов.
            Сценарии исключают узлы только из неё.
          </p>
          {data.resilience.scenarios.length ? (
            <div className="table-wrap">
              <p className="mobile-scroll-hint">Справа — контрольные сравнения. Прокрутите таблицу.</p>
              <table>
                <thead>
                  <tr>
                    <th>Исключено</th>
                    <th>Крупнейший фрагмент: приоритет</th>
                    <th>Фрагментов</th>
                    <th>Крупнейший: степень</th>
                    <th>Крупнейший: случайно, медиана</th>
                  </tr>
                </thead>
                <tbody>
                  {data.resilience.scenarios.map((scenario) => (
                    <tr key={scenario.removed_count}>
                      <td>Топ‑{scenario.removed_count}</td>
                      <td>{number(scenario.largest_after_priority)}</td>
                      <td>{number(scenario.components_after_priority)}</td>
                      <td>{number(scenario.largest_after_degree)}</td>
                      <td>{scenario.random_median_largest.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Компонента слишком мала для сценариев топ‑5/10/20.</p>
          )}
          <p className="muted">
            Случайный контроль: {data.resilience.random_draws} выборок с фиксированным seed.
            Это модель связности наблюдаемого графа, не прогноз эффекта реального блокирования счетов.
          </p>
        </details>
      </footer>
    </main>
  );
}
