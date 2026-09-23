import {
  labels,
  number,
  percent,
  roles,
  type Analysis,
  type Node,
  type Role,
} from "./types";

export function RoleRules({ node, data }: { node: Node; data: Analysis }) {
  const t = data.meta.config.thresholds;
  const ratio =
    node.pass_through?.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) ??
    "не определено";
  const rules: Record<Role, string[]> = {
    consolidator: [
      `${node.in_deg} плательщиков при пороге ≥ ${t.min_payers}`,
      `Достижим от ${node.reachable_seed_count} исходных клиентов при пороге ≥ ${t.min_seed_reach}`,
      `Доля крупнейшего плательщика ${node.in_concentration === null ? "не определена" : percent(node.in_concentration)} при пороге ≤ ${percent(t.max_concentration)}`,
    ],
    distributor: [
      `${node.out_deg} получателей при пороге ≥ ${t.min_recipients}`,
      `Доля крупнейшего получателя ${node.out_concentration === null ? "не определена" : percent(node.out_concentration)} при пороге ≤ ${percent(t.max_concentration)}`,
    ],
    transit: [
      `Новый участник; ${node.in_deg} плательщиков и ${node.out_deg} получателей (нужен хотя бы один с каждой стороны)`,
      `Получено ${number(node.in_kzt)} ₸, отправлено ${number(node.out_kzt)} ₸; каждый поток ≥ ${number(t.min_volume)} ₸`,
      `Отправлено / получено: ${ratio}; диапазон ${t.transit_ratio_min}–${t.transit_ratio_max}`,
      `Отправлено в течение 0–2 дней после поступления: ${percent(node.out_with_recent_in_share)} при пороге ≥ ${percent(t.min_recent_in_share)}`,
    ],
    terminal: [
      "Новый участник внутри границ наблюдения; есть хотя бы один плательщик",
      `Получено ${number(node.in_kzt)} ₸ при пороге ≥ ${number(t.min_volume)} ₸`,
      `Отправлено / получено: ${ratio} при пороге ≤ ${t.terminal_ratio_max}`,
    ],
    coordinator: [
      `Достижим от ${node.reachable_seed_count} исходных клиентов при пороге ≥ ${t.coordinator_seed_reach}`,
      `${node.neighbor_cluster_count} соседних групп при пороге ≥ ${t.min_neighbor_clusters}`,
      `Участие в кратчайших маршрутах: ${node.betweenness.toFixed(7)} при пороге ≥ ${t.min_betweenness}`,
    ],
    peripheral: ["Ни одно из правил основных ролей не выполнено полностью."],
  };
  const alternatives = roles.filter(
    (role) => role !== node.role && node.role_scores[role] > 0,
  );
  return (
    <div className="role-rules">
      <strong>Почему эта роль</strong>
      <ul>
        {rules[node.role].map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {alternatives.length > 0 && (
        <details>
          <summary>Пороги конкурирующих гипотез</summary>
          {alternatives.map((role) => (
            <div key={role}>
              <strong>{labels[role]}</strong>
              <ul>
                {rules[role].map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
