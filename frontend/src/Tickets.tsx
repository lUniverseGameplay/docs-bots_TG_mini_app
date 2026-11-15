import { useEffect, useState } from "react";
import { api, errorText, post } from "./api";
import { Markdown } from "./Markdown";
import { stateLabels } from "./Support";
import { useResource } from "./useResource";
import { read, write } from "./storage";
import type { Page, SupportCase, TicketView } from "./types";

export function Tickets({
  userId,
  admin = false,
  selected,
  onSelect,
}: {
  userId: number;
  admin?: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const base = admin ? "/admin/tickets" : "/tickets";
  const list = useResource<Page<SupportCase>>(selected ? null : base);
  const [older, setOlder] = useState<SupportCase[]>([]),
    [cursor, setCursor] = useState<number | string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    setOlder([]);
    setCursor(null);
  }, [base, selected]);
  async function more() {
    const next = cursor ?? list.value?.next_cursor;
    if (!next) return;
    setLoading(true);
    try {
      const page = await api<Page<SupportCase>>(
        base + "?before_request_id=" + next,
      );
      setOlder((previous) => [...previous, ...page.items]);
      setCursor(page.next_cursor ?? "end");
      setError(undefined);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }
  if (selected)
    return (
      <TicketChat
        key={base + selected}
        userId={userId}
        admin={admin}
        caseId={selected}
        onBack={() => onSelect(null)}
      />
    );
  const items = [...(list.value?.items ?? []), ...older].filter(
    (item, index, array) =>
      array.findIndex((other) => other.case_id === item.case_id) === index,
  );
  return (
    <section>
      <h1>{admin ? "Все тикеты" : "Мои тикеты"}</h1>
      <button
        onClick={() => {
          setOlder([]);
          setCursor(null);
          list.reload();
        }}
      >
        Обновить
      </button>
      {list.loading && !list.value && <p role="status">Загрузка тикетов…</p>}
      {Boolean(list.error || error) && (
        <p role="alert">{errorText(error ?? list.error)}</p>
      )}
      {list.value && items.length === 0 && (
        <p>
          Созданных тикетов пока нет. Ожидающие подтверждения обращения
          отображаются под ответом помощника.
        </p>
      )}
      <ul className="ticket-list">
        {items.map((item) => (
          <li key={item.case_id}>
            <button onClick={() => onSelect(item.case_id)}>
              <strong>Тикет №{item.request_id}</strong> ·{" "}
              {stateLabels[item.state]}
              <small>
                {item.created_at &&
                  new Date(item.created_at).toLocaleString("ru-RU")}
                {admin && " · пользователь " + item.user_id}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {cursor !== "end" && (cursor || list.value?.next_cursor) && (
        <button disabled={loading} onClick={() => void more()}>
          Загрузить ещё
        </button>
      )}
    </section>
  );
}

function TicketChat({
  userId,
  caseId,
  admin,
  onBack,
}: {
  userId: number;
  caseId: string;
  admin: boolean;
  onBack: () => void;
}) {
  const base = (admin ? "/admin/tickets/" : "/tickets/") + caseId;
  const resource = useResource<TicketView>(
    base + "/messages",
    5000,
    (value) => value.case.state !== "closed",
  );
  const [older, setOlder] = useState<TicketView["messages"]>([]),
    [cursor, setCursor] = useState<number | null | undefined>();
  const draftKey = "docs-mini:" + userId + ":ticket:" + caseId + ":" + admin;
  const saved = read<{ text: string; id: string | null }>(draftKey);
  const [text, setText] = useState(saved?.text ?? ""),
    [messageId, setMessageId] = useState<string | null>(saved?.id ?? null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function send() {
    const id = messageId ?? crypto.randomUUID();
    setMessageId(id);
    write(draftKey, { text, id });
    setBusy(true);
    setError(undefined);
    try {
      await post(base + "/messages", { client_message_id: id, text });
      setText("");
      setMessageId(null);
      write(draftKey, null);
      resource.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function earlier() {
    const next = cursor === undefined ? resource.value?.next_cursor : cursor;
    if (!next) return;
    setBusy(true);
    try {
      const page = await api<TicketView>(
        base + "/messages?before_message_id=" + next,
      );
      setOlder((previous) => [...page.messages, ...previous]);
      setCursor(page.next_cursor);
      setError(undefined);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    try {
      await post(base + "/close");
      resource.reload();
      setError(undefined);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const ticket = resource.value;
  const messages = [...older, ...(ticket?.messages ?? [])].filter(
    (item, index, array) =>
      array.findIndex((other) => other.message_id === item.message_id) ===
      index,
  );
  return (
    <section>
      <button onClick={onBack}>← К списку тикетов</button>
      <h1>Тикет {ticket ? "№" + ticket.case.request_id : ""}</h1>
      {Boolean(error || resource.error) && (
        <p role="alert">
          {errorText(error ?? resource.error)}{" "}
          <button onClick={resource.reload}>Обновить</button>
        </p>
      )}
      {!ticket && resource.loading && <p role="status">Загрузка переписки…</p>}
      {ticket && (
        <>
          <p>{stateLabels[ticket.case.state]}</p>
          <details>
            <summary>Исходный вопрос и ответ</summary>
            {ticket.history.map((entry, index) => (
              <div key={index}>
                <p className="user-message">{entry.question_text}</p>
                {entry.answer_text ? (
                  <Markdown text={entry.answer_text} />
                ) : (
                  <p>Подтверждённого ответа нет.</p>
                )}
              </div>
            ))}
          </details>
          {(cursor === undefined ? ticket.next_cursor : cursor) && (
            <button disabled={busy} onClick={() => void earlier()}>
              Предыдущие сообщения
            </button>
          )}
          <div className="conversation" aria-live="polite">
            {messages.length === 0 && <p>Сообщений пока нет.</p>}
            {messages.map((message) => (
              <article
                className={
                  message.author_role === "operator"
                    ? "bot-message"
                    : "user-message"
                }
                key={message.message_id}
              >
                <span className="label">
                  {message.author_role === "operator"
                    ? "Оператор"
                    : "Пользователь"}{" "}
                  · {new Date(message.created_at).toLocaleString("ru-RU")}
                </span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          {ticket.case.state === "closed" ? (
            <p>Тикет закрыт. Отправка новых сообщений недоступна.</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label htmlFor="ticket-message">
                {admin ? "Ответ оператора" : "Сообщение"}
              </label>
              <textarea
                id="ticket-message"
                maxLength={4096}
                required
                value={text}
                disabled={busy || Boolean(messageId)}
                onChange={(event) => {
                  setText(event.target.value);
                  write(draftKey, { text: event.target.value, id: null });
                }}
              />
              <button disabled={busy || !text.trim()}>
                {messageId ? "Повторить отправку" : "Отправить"}
              </button>
            </form>
          )}
          {admin && ticket.case.state === "open" && (
            <button disabled={busy} onClick={() => void close()}>
              Закрыть тикет
            </button>
          )}
        </>
      )}
    </section>
  );
}
