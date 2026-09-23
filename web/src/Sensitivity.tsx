import { labels, points, readable, type Analysis, type Node } from "./types";

export const scenarioLabels = {
  lower: "Пороги −10%",
  base: "Базовые пороги",
  higher: "Пороги +10%",
};
const thresholdLabels: Record<string, string> = {
  min_payers: "Плательщики",
  min_recipients: "Получатели",
  min_volume: "Объём, ₸",
  coordinator_seed_reach: "Охват исходных клиентов",
  min_neighbor_clusters: "Соседние кластеры",
  min_betweenness: "Участие в маршрутах",
};
const counts = new Set([
  "min_payers",
  "min_recipients",
  "coordinator_seed_reach",
  "min_neighbor_clusters",
]);

export function Sensitivity({
  node,
  data,
  expanded = false,
}: {
  node: Node;
  data: Analysis;
  expanded?: boolean;
}) {
  const changed = node.role_sensitivity.some((item) => item.role !== node.role);
  return (
    <details className="sensitivity" open={expanded || undefined}>
      <summary>
        Устойчивость роли ·{" "}
        {changed ? "чувствительна к порогам" : "сохранилась в трёх сценариях"}
      </summary>
      <p className="muted">
        Меняются шесть порогов. Приоритет остаётся базовым. Это проверка
        чувствительности, не вероятность и не оценка точности.
      </p>
      <div className="scenario-list">
        {node.role_sensitivity.map((item) => (
          <section key={item.scenario}>
            <h4>{scenarioLabels[item.scenario]}</h4>
            <strong>
              {labels[item.role]} · {points(item.role_score)} / 100
            </strong>
            {item.reasons.map((reason, i) => (
              <p key={i}>{readable(reason)}</p>
            ))}
          </section>
        ))}
      </div>
      <details open={expanded || undefined}>
        <summary>Изменяемые пороги</summary>
        <dl className="scenario-thresholds">
          {Object.entries(thresholdLabels).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {data.sensitivity.map((s) => {
                  const value = s.thresholds[key];
                  const formatted = Number(value.toPrecision(12)).toString();
                  return (
                    <span key={s.id}>
                      {scenarioLabels[s.id]}: ≥{formatted}
                      {counts.has(key) ? ` (целое ≥${Math.ceil(value)})` : ""}
                    </span>
                  );
                })}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </details>
  );
}
