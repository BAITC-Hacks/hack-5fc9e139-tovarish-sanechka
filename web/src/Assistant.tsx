import { useEffect, useRef, useState } from "react";
import {
  findCommonCandidates,
  findTemporalPath,
  structuralPath,
} from "./graphQueries";
import { Sensitivity } from "./Sensitivity";
import { labels, points, readable, type Analysis } from "./types";

type Operation =
  | { type: "node" | "sensitivity"; gid: string }
  | { type: "common"; seeds: string[] }
  | { type: "route"; source: string; target: string };
export type AssistantReply =
  | { operations: Operation[] }
  | { clarification: "missing_context" | "unsupported" };
export type AssistantMessage = { question: string; reply: AssistantReply };

export function validateReply(value: unknown, data: Analysis): AssistantReply {
  const fail = (): never => {
    throw new Error(
      "Ассистент вернул некорректный результат. Повторите вопрос.",
    );
  };
  if (!value || typeof value !== "object") return fail();
  if (
    "clarification" in value &&
    (value.clarification === "missing_context" ||
      value.clarification === "unsupported")
  )
    return { clarification: value.clarification };
  if (
    !("operations" in value) ||
    !Array.isArray(value.operations) ||
    !value.operations.length ||
    value.operations.length > 3
  )
    return fail();
  const nodes = new Map(data.nodes.map((n) => [n.gid, n]));
  for (const op of value.operations) {
    if (!op || typeof op !== "object") return fail();
    if (op.type === "node" || op.type === "sensitivity") {
      if (!nodes.has(op.gid)) return fail();
    } else if (op.type === "route") {
      if (!nodes.has(op.source) || !nodes.has(op.target)) return fail();
    } else if (op.type === "common") {
      if (
        !Array.isArray(op.seeds) ||
        op.seeds.length < 2 ||
        op.seeds.length > 5 ||
        new Set(op.seeds).size !== op.seeds.length ||
        !op.seeds.every((id: string) => nodes.get(id)?.is_seed)
      )
        return fail();
    } else return fail();
  }
  return value as AssistantReply;
}

function Result({
  operation,
  data,
  onSelect,
  onPath,
  onCommon,
}: {
  operation: Operation;
  data: Analysis;
  onSelect: (gid: string) => void;
  onPath: (path: string[], original?: string[]) => void;
  onCommon: (seeds: string[]) => void;
}) {
  if (operation.type === "common") {
    const found = findCommonCandidates(data, operation.seeds) ?? [];
    return (
      <article className="assistant-result">
        <h4>Общие достижимые участники</h4>
        <p>От исходных клиентов: {operation.seeds.join(", ")}.</p>
        <p>
          Найдено {found.length}. Порядок — по базовому приоритету; показаны
          первые {Math.min(10, found.length)}.
        </p>
        <p className="muted">
          Общая достижимость не подтверждает поступление одних и тех же денег.
        </p>
        <ol>
          {found.slice(0, 10).map((item) => (
            <li key={item.gid}>
              <button
                className="link-button"
                onClick={() => onSelect(item.gid)}
              >
                {item.gid}
              </button>{" "}
              · {labels[item.role]} · {points(item.priority_score)} / 100
            </li>
          ))}
        </ol>
        <button onClick={() => onCommon(operation.seeds)}>
          Открыть общий поиск
        </button>
      </article>
    );
  }
  if (operation.type === "route") {
    const original = structuralPath(data, operation.source, operation.target);
    const result = findTemporalPath(data, operation.source, operation.target);
    return (
      <article className="assistant-result">
        <h4>
          Маршрут {operation.source} → {operation.target}
        </h4>
        <p>
          {result.status === "not_found"
            ? "В наблюдаемом графе маршрут с неубывающими датами не найден."
            : result.path.length === 1
              ? "Источник и получатель совпадают: маршрут без переводов."
              : result.status === "same_day"
                ? "Порядок операций внутри дня неизвестен."
                : "Последовательность дат согласована."}
        </p>
        {result.path.length === 1 && (
          <button onClick={() => onSelect(operation.target)}>
            Открыть карточку {operation.target}
          </button>
        )}
        {result.path.length > 1 && (
          <>
            <p>{result.path.join(" → ")}</p>
            <p>{result.dates.join(" → ")}</p>
            <button
              onClick={() =>
                onPath(
                  result.path,
                  original.join() === result.path.join() ? [] : original,
                )
              }
            >
              Показать маршрут
            </button>
          </>
        )}
        {result.status === "not_found" && original.length > 0 && (
          <button onClick={() => onPath(original)}>
            Показать структурный маршрут
          </button>
        )}
        <p className="muted">
          Даты не доказывают движение одних и тех же средств.
        </p>
      </article>
    );
  }
  const node = data.nodes.find((n) => n.gid === operation.gid)!;
  return (
    <article className="assistant-result">
      <h4>
        {operation.type === "sensitivity"
          ? "Чувствительность роли"
          : "Участник"}{" "}
        {node.gid}
      </h4>
      <p>
        {labels[node.role]} · приоритет {points(node.priority_score)} / 100.
      </p>
      <p>{readable(node.evidence)}</p>
      {operation.type === "sensitivity" ? (
        <Sensitivity node={node} data={data} expanded />
      ) : (
        <p>Следующий запрос: {node.next_check}</p>
      )}
      <button onClick={() => onSelect(node.gid)}>
        Открыть карточку {node.gid}
      </button>
    </article>
  );
}

export function Assistant({
  open,
  data,
  selected,
  seeds,
  messages,
  onMessages,
  onClose,
  onSelect,
  onPath,
  onCommon,
}: {
  open: boolean;
  data: Analysis;
  selected: string;
  seeds: string[];
  messages: AssistantMessage[];
  onMessages: (messages: AssistantMessage[]) => void;
  onClose: () => void;
  onSelect: (gid: string) => void;
  onPath: (path: string[], original?: string[]) => void;
  onCommon: (seeds: string[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{
    enabled: boolean;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    const last = history.current?.lastElementChild as HTMLElement | null;
    if (history.current && last) history.current.scrollTop = last.offsetTop;
  }, [messages, open]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus(null);
    fetch("/api/assistant/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Не удалось проверить доступность ассистента.");
        const value = await response.json();
        if (
          typeof value.enabled !== "boolean" ||
          typeof value.message !== "string"
        )
          throw new Error("Некорректный статус ассистента.");
        setStatus(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setStatus({ enabled: false, message: reason.message });
      });
    return () => controller.abort();
  }, [open, attempt]);
  async function submit() {
    if (busy || !status?.enabled || !question.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort("timeout"), 65000);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          context: { selected, seeds },
          history: messages.slice(-6).map((m) => m.question),
        }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          typeof value.error === "string"
            ? value.error
            : "Ассистент недоступен. Повторите запрос.",
        );
      const reply = validateReply(value, data);
      onMessages([...messages, { question, reply }].slice(-6));
      setQuestion("");
    } catch (reason) {
      setError(
        controller.signal.aborted
          ? controller.signal.reason === "timeout"
            ? "Время ожидания истекло. Повторите запрос."
            : "Запрос отменён. Вопрос сохранён."
          : reason instanceof Error
            ? reason.message
            : "Не удалось получить ответ. Повторите запрос.",
      );
    } finally {
      clearTimeout(timer);
      abort.current = null;
      setBusy(false);
    }
  }
  return (
    <section
      className="assistant-panel panel"
      hidden={!open}
      aria-label="AI-ассистент"
    >
      <div className="section-head">
        <h2>Ассистент аналитика</h2>
        <button onClick={onClose}>Закрыть ассистента</button>
      </div>
      <p className="muted">
        Alem распознаёт вопрос; факты и маршруты вычисляет приложение.
        Передаются вопрос, идентификаторы контекста и до шести предыдущих
        вопросов. Граф и заметки не отправляются.
      </p>
      <p>
        Выбран участник {selected}. Исходные клиенты:{" "}
        {seeds.length ? seeds.join(", ") : "не выбраны"}.
      </p>
      {!status ? (
        <p role="status">Проверяем настройки…</p>
      ) : (
        !status.enabled && (
          <p role="status">
            {status.message}{" "}
            <button onClick={() => setAttempt((n) => n + 1)}>
              Проверить снова
            </button>
          </p>
        )
      )}
      <div className="assistant-history" ref={history}>
        {messages.map((message, i) => (
          <section key={i} className="assistant-message">
            <h3>{message.question}</h3>
            {"clarification" in message.reply ? (
              <p>
                {message.reply.clarification === "missing_context"
                  ? "Уточните идентификаторы участников и действие: карточка, общие получатели, маршрут или устойчивость роли."
                  : "Доступны карточки участников, общие получатели, маршруты и чувствительность ролей. Сформулируйте вопрос об одной из этих задач."}
              </p>
            ) : (
              message.reply.operations.map((operation, index) => (
                <Result
                  key={index}
                  operation={operation}
                  data={data}
                  onSelect={onSelect}
                  onPath={onPath}
                  onCommon={onCommon}
                />
              ))
            )}
          </section>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="assistant-question">Вопрос ассистенту</label>
        <textarea
          id="assistant-question"
          ref={input}
          rows={3}
          maxLength={2000}
          value={question}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Например: почему у выбранного участника такая роль?"
        />
        <div className="assistant-actions">
          <button
            type="submit"
            disabled={busy || !status?.enabled || !question.trim()}
          >
            {error ? "Повторить запрос" : "Спросить"}
          </button>
          {!question && !busy && (
            <button
              type="button"
              onClick={() =>
                setQuestion("Насколько устойчива роль выбранного участника?")
              }
            >
              Проверить устойчивость роли
            </button>
          )}
          {busy && (
            <button type="button" onClick={() => abort.current?.abort()}>
              Отменить запрос
            </button>
          )}
        </div>
        {busy && <p role="status">Alem разбирает вопрос…</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
