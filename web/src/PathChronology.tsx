import { number, type Edge } from "./types";

export function checkPathChronology(edges: Pick<Edge, "dates">[]) {
  // Earliest admissible dates leave the most room for every following step.
  // Try strict ordering first: an early same-day choice can have a later alternative.
  for (const strict of [true, false]) {
    const dates: string[] = [];
    for (const edge of edges) {
      const previous = dates.at(-1);
      const day = edge.dates.find((value) => previous === undefined ||
        (strict ? value > previous : value >= previous));
      if (day === undefined) break;
      dates.push(day);
    }
    if (dates.length === edges.length)
      return { status: strict ? "ordered" : "same_day", dates, failedStep: null } as const;
    if (!strict) return { status: "inconsistent", dates, failedStep: dates.length } as const;
  }
  throw new Error("Не удалось проверить хронологию пути");
}

export function PathChronology({ edges, onSelect }: {
  edges: Edge[];
  onSelect: (gid: string) => void;
}) {
  if (!edges.length) return null;
  const result = checkPathChronology(edges);
  const failed = result.failedStep === null ? null : edges[result.failedStep];
  const status = edges.length === 1 ? "Один шаг: дата операции указана ниже" :
    result.status === "ordered" ? "Последовательность дат согласована" :
    result.status === "same_day" ? "Порядок внутри дня неизвестен" :
    "Выбранный путь не согласован по датам";
  return (
    <div className="path-chronology">
      <p className="chronology-status"><strong>{status}</strong></p>
      {failed && <p className="muted">
        Последовательность прерывается на шаге {result.failedStep! + 1}: {failed.src} → {failed.dst}.
        {" "}Доступные даты: {failed.dates.join(", ")}. Другой маршрут может существовать.
      </p>}
      <ol>
        {edges.map((edge, index) => (
          <li key={edge.id}>
            <span className="path-step">
              <button className="link-button" onClick={() => onSelect(edge.src)}>{edge.src}</button>
              <span aria-hidden="true">→</span>
              <button className="link-button" onClick={() => onSelect(edge.dst)}>{edge.dst}</button>
            </span>
            <span>{number(edge.sum_kzt)} ₸ · {edge.n_tx} операций за июль</span>
            <small>{result.dates[index]
              ? `Дата операции: ${result.dates[index]}`
              : `Даты операций: ${edge.dates.join(", ")}`}</small>
          </li>
        ))}
      </ol>
      {edges.length > 1 && <p className="muted">
        Согласование дат не подтверждает движение одной суммы. Суммы рёбер — за весь месяц.
      </p>}
    </div>
  );
}
