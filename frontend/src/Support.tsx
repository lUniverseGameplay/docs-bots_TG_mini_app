import { useState } from "react";
import { errorText, post } from "./api";
import { useResource } from "./useResource";
import type { Page, SupportCase } from "./types";

export const stateLabels: Record<SupportCase["state"], string> = {
  waiting: "Ожидание самостоятельного решения",
  awaiting_confirmation: "Нужно подтверждение",
  creating: "Создаём обращение",
  open: "Открыто",
  closed: "Закрыто",
  cancelled: "Обращение отменено",
};
export function SupportPanel({
  initial,
  onTicket,
  poll = true,
}: {
  initial: SupportCase;
  onTicket: (id: string) => void;
  poll?: boolean;
}) {
  const resource = useResource<SupportCase>(
    "/support/" + initial.case_id,
    poll ? 5000 : 0,
    (value) => !["open", "closed", "cancelled"].includes(value.state),
  );
  const current = resource.value ?? initial;
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function decide(action: string) {
    setBusy(true);
    setError(undefined);
    try {
      await post("/support/" + current.case_id + "/" + action);
      resource.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="support">
      <strong>Поддержка: {stateLabels[current.state]}</strong>
      {current.state === "waiting" && (
        <p>
          Пока можно поискать ответ самостоятельно. Подтверждение помощи станет
          доступно{" "}
          {current.check_at
            ? new Date(current.check_at).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "через 10 минут"}
          . Закрытие приложения не сбросит ожидание.
        </p>
      )}
      {current.state === "awaiting_confirmation" && (
        <div className="actions">
          <button disabled={busy} onClick={() => void decide("confirm")}>
            Помощь всё ещё нужна
          </button>
          <button disabled={busy} onClick={() => void decide("decline")}>
            Вопрос решён
          </button>
        </div>
      )}
      {["open", "closed"].includes(current.state) && (
        <button onClick={() => onTicket(current.case_id)}>
          Открыть обращение
        </button>
      )}
      {Boolean(error || resource.error) && (
        <p role="alert">
          {errorText(error ?? resource.error)}{" "}
          <button onClick={resource.reload}>Обновить</button>
        </p>
      )}
    </aside>
  );
}

export function SupportInbox({ onTicket }: { onTicket: (id: string) => void }) {
  const [cursor, setCursor] = useState<number | null>(null),
    [selected, setSelected] = useState<SupportCase | null>(null);
  const resource = useResource<Page<SupportCase>>(
    "/support" + (cursor ? "?before_request_id=" + cursor : ""),
    10000,
  );
  return (
    <details className="support-inbox">
      <summary>Ожидающие обращения поддержки</summary>
      <p className="muted">
        Эти обращения сохраняются после нового вопроса и повторного открытия
        приложения.
      </p>
      {resource.loading && !resource.value && (
        <p role="status">Загрузка обращений…</p>
      )}
      {Boolean(resource.error) && (
        <p role="alert">
          {errorText(resource.error)}{" "}
          <button onClick={resource.reload}>Обновить обращения</button>
        </p>
      )}
      {resource.value?.items.length === 0 && (
        <p>Незавершённых обращений на этой странице нет.</p>
      )}
      <ul>
        {resource.value?.items.map((item) => (
          <li key={item.case_id}>
            <button onClick={() => setSelected(item)}>
              Вопрос №{item.request_id}: {stateLabels[item.state]}
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        {cursor && (
          <button onClick={() => setCursor(null)}>К новым обращениям</button>
        )}
        {resource.value?.next_cursor && (
          <button
            onClick={() => setCursor(Number(resource.value!.next_cursor))}
          >
            Предыдущие обращения
          </button>
        )}
      </div>
      {selected && (
        <SupportPanel
          key={selected.case_id}
          initial={selected}
          onTicket={onTicket}
        />
      )}
    </details>
  );
}
