export function Pagination({
  count,
  page,
  size,
  onChange,
}: {
  count: number;
  page: number;
  size: number;
  onChange: (page: number, size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  return (
    <div className="pagination">
      <button disabled={page === 0} onClick={() => onChange(page - 1, size)}>
        Назад
      </button>
      <label>
        Страница
        <input
          aria-label="Страница"
          type="number"
          min={1}
          max={pages}
          value={page + 1}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isInteger(value))
              onChange(Math.max(0, Math.min(pages - 1, value - 1)), size);
          }}
        />
      </label>
      <span>из {pages}</span>
      <button
        disabled={page + 1 >= pages}
        onClick={() => onChange(page + 1, size)}
      >
        Далее
      </button>
      <label>
        На странице
        <select
          aria-label="На странице"
          value={size}
          onChange={(event) => onChange(0, Number(event.target.value))}
        >
          {[10, 20, 50].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
