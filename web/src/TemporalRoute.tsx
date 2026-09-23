import { useEffect, useState } from "react";
import { type Analysis } from "./types";
import { checkPathChronology } from "./PathChronology";
import { findTemporalPath, pathEdges } from "./graphQueries";

export function TemporalRoute({
  data,
  path,
  originalPath,
  onShow,
}: {
  data: Analysis;
  path: string[];
  originalPath: string[];
  onShow: (path: string[], original?: string[]) => void;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    setNotice("");
    setError(false);
  }, [path.join(",")]);
  if (path.length < 2) return null;
  const status = checkPathChronology(pathEdges(data, path)).status;
  function search() {
    try {
      const result = findTemporalPath(data, path[0], path.at(-1)!);
      setError(false);
      if (result.status === "not_found")
        setNotice("В наблюдаемом графе путь с неубывающими датами не найден.");
      else if (result.path.join() === path.join())
        setNotice(
          "Строго возрастающий порядок не найден. Для этого маршрута порядок операций внутри дня неизвестен.",
        );
      else onShow(result.path, originalPath.length ? originalPath : path);
    } catch (reason) {
      setError(true);
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Не удалось вычислить маршрут. Повторите поиск.",
      );
    }
  }
  return (
    <div className="temporal-route">
      {originalPath.length > 0 && (
        <>
          <p>
            <strong>Показан маршрут, найденный с учётом дат.</strong>
          </p>
          <button onClick={() => onShow(originalPath)}>
            Вернуться к исходному маршруту
          </button>
        </>
      )}
      {status !== "ordered" && (
        <button onClick={search}>Найти путь с согласованными датами</button>
      )}
      {notice && <p role={error ? "alert" : "status"}>{notice}</p>}
    </div>
  );
}
