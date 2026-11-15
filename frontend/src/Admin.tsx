import { useState } from "react";
import { Icon, PageHeading } from "./UI";
import { api, errorText } from "./api";
import { useResource } from "./useResource";
import type { Page } from "./types";

interface Access {
  username: string;
  enabled: boolean;
}
export function Users({ onAccessChanged }: { onAccessChanged?: () => void }) {
  const resource = useResource<Page<Access>>("/admin/users");
  const [older, setOlder] = useState<Access[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [username, setUsername] = useState(""),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [success, setSuccess] = useState(""),
    [search, setSearch] = useState("");
  const items = [...(resource.value?.items ?? []), ...older].filter(
    (item, index, all) =>
      all.findIndex((other) => other.username === item.username) === index,
  );
  async function save(name: string, allowed: boolean) {
    if (
      busy ||
      (!allowed &&
        !window.confirm("Отозвать доступ @" + name.replace(/^@/, "") + "?"))
    )
      return;
    setBusy(true);
    setError(undefined);
    setSuccess("");
    try {
      await api(
        "/admin/users/" +
          encodeURIComponent(name.replace(/^@/, "").toLowerCase()),
        { method: "PUT", body: JSON.stringify({ enabled: allowed }) },
      );
      setSuccess("Допуск обновлён");
      setOlder([]);
      setCursor(undefined);
      resource.reload();
      onAccessChanged?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    const next = cursor === undefined ? resource.value?.next_cursor : cursor;
    if (!next) return;
    setBusy(true);
    try {
      const page = await api<Page<Access>>(
        "/admin/users?after=" + encodeURIComponent(String(next)),
      );
      setOlder((previous) => [...previous, ...page.items]);
      setCursor(page.next_cursor as string | null);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="access-page">
      <PageHeading
        title="Допуски"
        description="Управление доступом к помощнику"
        icon="users"
      />
      <p>Допуск разрешает пользователю задавать вопросы по документации.</p>
      <form
        className="access-form card"
        onSubmit={(event) => {
          event.preventDefault();
          void save(username, enabled);
        }}
      >
        <h2>Выдать доступ пользователю</h2>
        <label htmlFor="access-username">Telegram username</label>
        <input
          id="access-username"
          placeholder="@username"
          disabled={busy}
          pattern="@?[A-Za-z0-9_]{1,32}"
          maxLength={33}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={busy}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Допуск разрешён
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Сохраняем…" : enabled ? "Выдать доступ" : "Отозвать доступ"}
        </button>
      </form>
      {success && <p role="status">{success}</p>}
      {Boolean(error || resource.error) && (
        <p role="alert">
          {errorText(error ?? resource.error)}{" "}
          <button onClick={resource.reload}>Обновить</button>
        </p>
      )}
      {resource.loading && <p role="status">Загрузка…</p>}
      <div className="access-summary">
        <span>
          <Icon name="users" /> Загружено: <strong>{items.length}</strong>
        </span>
        <span>
          <span className="live-dot" /> С доступом:{" "}
          <strong>{items.filter((item) => item.enabled).length}</strong>
        </span>
      </div>
      <label className="search-field">
        <Icon name="search" />
        <input
          aria-label="Поиск по username"
          placeholder="Поиск по username…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <ul className="access-list">
        {items
          .filter((item) =>
            item.username
              .toLowerCase()
              .includes(search.replace(/^@/, "").toLowerCase()),
          )
          .map((item) => (
            <li key={item.username}>
              <span className="access-avatar">
                <Icon name="users" />
              </span>
              <div>
                <strong>@{item.username}</strong>
                <small className={item.enabled ? "access-enabled" : "muted"}>
                  {item.enabled ? "Доступ разрешён" : "Доступ отключён"}
                </small>
              </div>
              <button
                disabled={busy}
                onClick={() => void save(item.username, !item.enabled)}
              >
                <Icon name={item.enabled ? "trash" : "check"} />
                {item.enabled ? "Отозвать" : "Разрешить"}
              </button>
            </li>
          ))}
      </ul>
      {search &&
        !items.some((item) =>
          item.username
            .toLowerCase()
            .includes(search.replace(/^@/, "").toLowerCase()),
        ) && (
          <p className="empty-state">
            По вашему запросу ничего не найдено среди загруженных пользователей.
          </p>
        )}
      {resource.value?.items.length === 0 && <p>Список допуска пуст.</p>}
      {(cursor === undefined ? resource.value?.next_cursor : cursor) && (
        <button disabled={busy} onClick={() => void more()}>
          Загрузить ещё
        </button>
      )}
    </section>
  );
}

interface Metrics {
  requests: number;
  answered: number;
  escalated: number;
  dissatisfied: number;
  reply_duration_ms: number[];
  ticket_duration_ms: number[];
  web_result_duration_ms: number[];
  topics: Record<string, number> | null;
}
function Durations({ name, values }: { name: string; values: number[] }) {
  return (
    <details>
      <summary>
        {name}: {values.length} наблюдений
      </summary>
      {values.length ? (
        <>
          <p>
            Среднее:{" "}
            {(values.reduce((a, b) => a + b, 0) / values.length / 1000).toFixed(
              2,
            )}{" "}
            с
          </p>
          <ol>
            {values.map((value, index) => (
              <li key={index}>{(value / 1000).toFixed(2)} с</li>
            ))}
          </ol>
        </>
      ) : (
        <p>Данных пока нет.</p>
      )}
    </details>
  );
}
export function Metrics() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(
      new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    ),
    [query, setQuery] = useState<string | null>(null);
  const resource = useResource<Metrics>(query),
    data = resource.value;
  return (
    <section>
      <h1>Бизнес-метрики</h1>
      <p>Период в UTC: начало включается, конец не включается.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(
            "/admin/metrics?" +
              new URLSearchParams({
                from_at: from + "T00:00:00Z",
                to_at: to + "T00:00:00Z",
              }),
          );
          resource.reload();
        }}
      >
        <label htmlFor="metrics-from">С</label>
        <input
          id="metrics-from"
          type="date"
          required
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <label htmlFor="metrics-to">До</label>
        <input
          id="metrics-to"
          type="date"
          required
          min={from}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <button disabled={resource.loading || from >= to}>Показать</button>
      </form>
      {resource.loading && <p role="status">Считаем метрики…</p>}
      {Boolean(resource.error) && (
        <p role="alert">
          {errorText(resource.error)}{" "}
          <button onClick={resource.reload}>Повторить</button>
        </p>
      )}
      {data && (
        <>
          <dl className="stats">
            {(
              [
                ["Вопросы", data.requests],
                ["Ответы по документации", data.answered],
                ["Переданы в поддержку", data.escalated],
                ["Ответ не помог", data.dissatisfied],
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <Durations
            name="Доступность результата Mini App"
            values={data.web_result_duration_ms}
          />
          <Durations
            name="Подтверждённая доставка ответа Telegram"
            values={data.reply_duration_ms}
          />
          <Durations
            name="Закрытие обращения"
            values={data.ticket_duration_ms}
          />
          {data.topics ? (
            <ul>
              {Object.entries(data.topics).map(([topic, count]) => (
                <li key={topic}>
                  {topic}: {count}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Разметка метрик по темам пока не настроена.</p>
          )}
        </>
      )}
    </section>
  );
}
