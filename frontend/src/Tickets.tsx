import { useEffect, useRef, useState } from "react";
import { api, errorText, post } from "./api";
import { Icon, PageHeading, StatusBadge } from "./UI";
import { Markdown } from "./Markdown";
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
  const [filter, setFilter] = useState("all");
  const base = admin ? "/admin/tickets" : "/tickets";
  const list = useResource<Page<SupportCase>>(
    admin || !selected ? base : null,
    10000,
  );
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
  const items = [...(list.value?.items ?? []), ...older].filter(
    (item, index, array) =>
      array.findIndex((other) => other.case_id === item.case_id) === index,
  );
  const visibleItems = items.filter(
    (item) => filter === "all" || item.state === filter,
  );
  return (
    <section
      className={
        admin
          ? "queue-page" + (selected ? " has-selection" : "")
          : "appeals-page"
      }
    >
      {(!selected || admin) && (
        <>
          <PageHeading
            title={admin ? "Очередь обращений" : "Мои обращения"}
            description={
              admin
                ? "Рабочее пространство поддержки"
                : "Ваша переписка с поддержкой"
            }
            icon={admin ? "headset" : "tickets"}
          />
        </>
      )}
      <div className={admin ? "queue-layout" : "appeals-layout"}>
        <div
          className={
            selected && !admin
              ? "appeal-sidebar mobile-hidden"
              : "appeal-sidebar"
          }
        >
          <div className="list-toolbar">
            <div
              className="filter-tabs"
              role="group"
              aria-label="Фильтр обращений"
            >
              {[
                ["all", "Все"],
                ["open", "Открытые"],
                ["closed", "Закрытые"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  <span>
                    {
                      items.filter(
                        (item) => key === "all" || item.state === key,
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setOlder([]);
                setCursor(null);
                list.reload();
              }}
            >
              <Icon name="refresh" />
              <span className="sr-only">Обновить</span>
            </button>
          </div>
          {list.loading && !list.value && (
            <p role="status">Загрузка обращений…</p>
          )}
          {Boolean(list.error || error) && (
            <p role="alert">{errorText(error ?? list.error)}</p>
          )}
          {list.value && items.length === 0 && (
            <p>
              Созданных обращений пока нет. Ожидающие подтверждения обращения
              отображаются под ответом помощника.
            </p>
          )}
          {list.value && items.length > 0 && visibleItems.length === 0 && (
            <p className="empty-state">В этом разделе обращений пока нет.</p>
          )}
          {list.value?.next_cursor && (
            <p className="muted page-note">
              Фильтры и счётчики учитывают загруженные обращения.
            </p>
          )}
          <ul className="ticket-list">
            {visibleItems.map((item) => (
              <li key={item.case_id}>
                <button
                  className={
                    selected === item.case_id
                      ? "appeal-card selected"
                      : "appeal-card"
                  }
                  onClick={() => onSelect(item.case_id)}
                >
                  <div className="appeal-meta">
                    <span>№{item.request_id}</span>
                    <time>
                      {item.created_at &&
                        new Date(item.created_at).toLocaleDateString("ru-RU")}
                    </time>
                  </div>
                  <strong>Обращение №{item.request_id}</strong>
                  <p>
                    {admin
                      ? "Пользователь " + item.user_id
                      : "Переписка с оператором поддержки"}
                  </p>
                  <StatusBadge state={item.state} />
                  <span className="card-chevron">
                    <Icon name="chevron" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor !== "end" && (cursor || list.value?.next_cursor) && (
            <button disabled={loading} onClick={() => void more()}>
              Загрузить ещё
            </button>
          )}
        </div>
        {selected ? (
          <TicketChat
            key={base + selected}
            userId={userId}
            admin={admin}
            caseId={selected}
            onBack={() => onSelect(null)}
          />
        ) : (
          admin && (
            <div className="workspace-empty empty-state">
              <Icon name="headset" size={36} />
              <h2>Выберите обращение</h2>
              <p>Контекст и переписка появятся здесь.</p>
            </div>
          )
        )}
      </div>
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
    if (busy || !text.trim()) return;
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
    if (
      busy ||
      !window.confirm(
        "Закрыть обращение? Отправка новых сообщений станет недоступна.",
      )
    )
      return;
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
  const conversation = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const ticket = resource.value;
  useEffect(() => {
    const el = conversation.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [ticket?.messages]);
  const messages = [...older, ...(ticket?.messages ?? [])].filter(
    (item, index, array) =>
      array.findIndex((other) => other.message_id === item.message_id) ===
      index,
  );
  return (
    <section className="ticket-workspace">
      <button className="back-button" onClick={onBack}>
        <Icon name="arrow" /> К списку обращений
      </button>
      <h1>Обращение {ticket ? "№" + ticket.case.request_id : ""}</h1>
      {Boolean(error || resource.error) && (
        <p role="alert">
          {errorText(error ?? resource.error)}{" "}
          <button onClick={resource.reload}>Обновить</button>
        </p>
      )}
      {!ticket && resource.loading && <p role="status">Загрузка переписки…</p>}
      {ticket && (
        <>
          <StatusBadge state={ticket.case.state} />
          <details className="appeal-context">
            <summary>
              <Icon name="layers" /> Контекст вопроса и ответа
              <small>
                {ticket.history[0]?.question_text ??
                  "Исходный вопрос и ответ помощника"}
              </small>
            </summary>
            {ticket.history.map((entry, index) => (
              <div key={index}>
                <span className="label">Вопрос пользователя</span>
                <p className="context-question">{entry.question_text}</p>
                <span className="label">Ответ бота</span>
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
          <div
            className="conversation support-conversation"
            ref={conversation}
            onScroll={() => {
              const el = conversation.current;
              if (el)
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            aria-live="polite"
          >
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
            <p>Обращение закрыто. Отправка новых сообщений недоступна.</p>
          ) : (
            <form
              className="composer support-composer"
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
                placeholder={
                  admin ? "Введите ответ пользователю…" : "Введите сообщение…"
                }
                rows={2}
                value={text}
                disabled={busy || Boolean(messageId)}
                onChange={(event) => {
                  setText(event.target.value);
                  write(draftKey, { text: event.target.value, id: null });
                }}
              />
              <button className="primary" disabled={busy || !text.trim()}>
                <Icon name="send" />
                {messageId ? "Повторить отправку" : "Отправить"}
              </button>
            </form>
          )}
          {admin && ticket.case.state === "open" && (
            <button disabled={busy} onClick={() => void close()}>
              Закрыть обращение
            </button>
          )}
        </>
      )}
    </section>
  );
}
