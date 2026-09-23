import { useEffect, useMemo, useRef, useState } from "react";
import { checkPathChronology } from "./PathChronology";
import { findTemporalPath, pathEdges } from "./graphQueries";
import { Sensitivity } from "./Sensitivity";
import {
  colors,
  labels,
  number,
  points,
  readable,
  roles,
  type Analysis,
  type Node,
} from "./types";
import { type Decision } from "./workspace";

function RouteEvidence({
  data,
  path,
  title,
}: {
  data: Analysis;
  path: string[];
  title: string;
}) {
  const edges = pathEdges(data, path);
  const chronology = checkPathChronology(edges);
  return (
    <section className="dossier-route">
      <h3>{title}</h3>
      <p>
        {path[0]} → {path.at(-1)} · {edges.length} шагов
      </p>
      <p>
        {chronology.status === "ordered"
          ? "Последовательность дат согласована."
          : chronology.status === "same_day"
            ? "Порядок операций внутри дня неизвестен."
            : "Выбранный путь не согласован по датам."}
      </p>
      {edges.map((edge, i) => {
        const day = chronology.dates[i];
        const operations = day
          ? edge.operations.filter((op) => op.date === day)
          : edge.operations;
        const source = data.nodes.find((n) => n.gid === edge.src)!;
        const target = data.nodes.find((n) => n.gid === edge.dst)!;
        return (
          <article className="dossier-step" key={`${i}:${edge.id}`}>
            <h4>
              Шаг {i + 1}
              {chronology.failedStep === i ? " · конфликт дат" : ""}
            </h4>
            <svg
              viewBox="0 0 520 86"
              role="img"
              aria-label={`Переводы от ${edge.src} к ${edge.dst}`}
            >
              <rect
                x="1"
                y="1"
                width="221"
                height="74"
                rx="5"
                fill="#f6f9fc"
                stroke={colors[source.role]}
              />
              <rect
                x="298"
                y="1"
                width="221"
                height="74"
                rx="5"
                fill="#f6f9fc"
                stroke={colors[target.role]}
              />
              <text
                x="111"
                y="30"
                textAnchor="middle"
                fontSize="17"
                fontFamily="monospace"
              >
                {edge.src}
              </text>
              <text
                x="409"
                y="30"
                textAnchor="middle"
                fontSize="17"
                fontFamily="monospace"
              >
                {edge.dst}
              </text>
              <text x="111" y="54" textAnchor="middle" fontSize="13">
                {labels[source.role]}
              </text>
              <text x="409" y="54" textAnchor="middle" fontSize="13">
                {labels[target.role]}
              </text>
              <path
                d="M230 36 H285 M277 28 L285 36 L277 44"
                fill="none"
                stroke="#2165ac"
                strokeWidth="2"
              />
            </svg>
            <p>
              За месяц: {number(edge.sum_kzt)} ₸ · {edge.n_tx} операций.
            </p>
            <p>
              {day
                ? `Операции выбранной даты ${day}:`
                : "Согласованная дата не выбрана; все операции этой связи:"}
            </p>
            <ul className="operation-list">
              {operations.map((op) => (
                <li key={op.index}>
                  Строка {op.index + 1} transactions.parquet · {op.date} ·{" "}
                  {number(op.sum_kzt)} ₸
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}

export function Dossier({
  node,
  data,
  paths,
  decision,
  onClose,
}: {
  node: Node;
  data: Analysis;
  paths: string[][];
  decision: Decision;
  onClose: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const [created] = useState(() => new Date().toLocaleString("ru-RU"));
  useEffect(() => {
    title.current?.focus();
  }, []);
  const routes = useMemo(
    () =>
      paths
        .filter((path) => path.length > 1)
        .map((path) => {
          const status = checkPathChronology(pathEdges(data, path)).status;
          const alternative =
            status !== "ordered"
              ? findTemporalPath(data, path[0], path.at(-1)!)
              : null;
          return { path, status, alternative };
        }),
    [data, paths],
  );
  const changed = node.role_sensitivity.some((s) => s.role !== node.role);
  const competing = roles.filter(
    (role) => role !== node.role && node.role_scores[role] > 0,
  );
  const rank = data.top_nodes.find((n) => n.gid === node.gid)!.rank;
  return (
    <main className="dossier panel">
      <nav className="dossier-actions" aria-label="Действия с досье">
        <button onClick={onClose}>Вернуться к расследованию</button>
        <button onClick={() => window.print()}>Печать / сохранить PDF</button>
      </nav>
      <h1 ref={title} tabIndex={-1}>
        Досье участника
      </h1>
      <p className="node-id">{node.gid}</p>
      <p>
        Период: {data.meta.period_start} — {data.meta.period_end}. Сформировано:{" "}
        {created}.
      </p>
      <p>
        <strong>{labels[node.role]}</strong> · оценка роли{" "}
        {points(node.role_score)} / 100 · место № {rank}.
      </p>
      <p>{readable(node.evidence)}</p>
      <p>
        Гипотеза для проверки, не утверждение о виновности. Баллы не являются
        вероятностью.
      </p>
      <h2>Потоки и приоритет</h2>
      <p>
        Получено {number(node.in_kzt)} ₸ от {node.in_deg} плательщиков (
        {node.in_tx} операций); отправлено {number(node.out_kzt)} ₸{" "}
        {node.out_deg} получателям ({node.out_tx} операций).
      </p>
      <p>
        Приоритет: {points(node.priority_score)} / 100. Вклады: охват{" "}
        {points(node.priority_seed_reach)}, структура{" "}
        {points(node.priority_structure)}, оборот {points(node.priority_volume)}{" "}
        балла.
      </p>
      <p>
        Достижим от {node.reachable_seed_count} исходных клиентов. Кластер{" "}
        {node.cluster_id}; колено сбора {node.depth}.
      </p>
      <h2>Что ослабляет гипотезу</h2>
      <ul>
        {changed && (
          <li>Основная роль меняется при изменении порогов на 10%.</li>
        )}
        {competing.length > 0 && (
          <li>
            Допустимы конкурирующие роли:{" "}
            {competing.map((r) => labels[r]).join(", ")}.
          </li>
        )}
        {routes.some((r) => r.status === "inconsistent") && (
          <li>
            Есть конфликт дат в исходном кратчайшем маршруте. Альтернатива
            приведена ниже, если найдена.
          </li>
        )}
        {routes.some(
          (r) =>
            r.status === "same_day" || r.alternative?.status === "same_day",
        ) && <li>Внутридневной порядок операций неизвестен.</li>}
        {node.truncated_by_depth && (
          <li>
            Граница четвёртого колена: дальнейшие исходящие переводы неизвестны.
          </li>
        )}
        {node.is_seed && <li>Входящие исходного клиента неполны.</li>}
        {node.data_warnings.includes("no_observed_transfers") && (
          <li>В выборке отсутствуют операции участника.</li>
        )}
        <li>
          Выборка неполна: только внутрибанковские операции от 5 000 ₸ за
          указанный период.
        </li>
        <li>
          Согласованность дат не доказывает движение одних и тех же средств.
          Оборот по цепочке повторно учитывает деньги.
        </li>
      </ul>
      <Sensitivity node={node} data={data} expanded />
      <h2>Маршруты и операции</h2>
      {!routes.length && (
        <p>
          Маршрут от другого исходного клиента отсутствует в наблюдаемом графе.
        </p>
      )}
      {routes.map(({ path, alternative }, i) => (
        <section key={path.join(":")}>
          <RouteEvidence
            data={data}
            path={path}
            title={`Исходный маршрут ${i + 1}`}
          />
          {alternative?.status === "not_found" && (
            <p>
              Альтернативный путь с неубывающими датами в наблюдаемом графе не
              найден.
            </p>
          )}
          {alternative &&
            alternative.path.length > 1 &&
            alternative.path.join() !== path.join() && (
              <RouteEvidence
                data={data}
                path={alternative.path}
                title="Маршрут с учётом дат"
              />
            )}
          {alternative?.status === "same_day" &&
            alternative.path.join() === path.join() && (
              <p>
                Строго согласованная альтернатива не найдена. Порядок внутри дня
                остаётся неизвестным.
              </p>
            )}
        </section>
      ))}
      <h2>Решение аналитика</h2>
      <p>
        {decision.included
          ? "Включён в список проверки."
          : "Не включён в список проверки."}
      </p>
      <p className="dossier-note">{decision.note || "Заметка не добавлена."}</p>
      <h2>Следующий запрос</h2>
      <p>{node.next_check}</p>
    </main>
  );
}
