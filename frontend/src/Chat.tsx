import { useEffect, useState } from "react";
import { ApiError, errorText, post } from "./api";
import { Orb, Icon } from "./UI";
import { Answer } from "./Markdown";
import { SupportPanel, SupportInbox } from "./Support";
import { useResource } from "./useResource";
import { read, write } from "./storage";
import type { Me, Question, SupportCase } from "./types";

interface Pending {
  key: string;
  text: string;
}
function restorePending(key: string) {
  const value = read<Pending>(key);
  return value &&
    typeof value.key === "string" &&
    /^[A-Za-z0-9._:-]{8,128}$/.test(value.key) &&
    typeof value.text === "string" &&
    value.text.trim()
    ? value
    : null;
}
function restoreRequest(key: string) {
  const value = read<number>(key);
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
export function Chat({
  me,
  onTicket,
  visible = true,
}: {
  visible?: boolean;
  me: Me;
  onTicket: (id: string) => void;
}) {
  const prefix = "docs-mini:" + me.user_id;
  const [pending, setPending] = useState<Pending | null>(() =>
    restorePending(prefix + ":pending"),
  );
  const [text, setText] = useState(pending?.text ?? "");
  const [current, setCurrent] = useState<number | null>(
    () => me.active_request_id ?? restoreRequest(prefix + ":request"),
  );
  useEffect(() => {
    if (me.active_request_id) {
      setCurrent(me.active_request_id);
      write(prefix + ":request", me.active_request_id);
    }
  }, [me.active_request_id, prefix]);
  const [entries, setEntries] = useState<Question[]>([]),
    [sending, setSending] = useState(false),
    [error, setError] = useState<unknown>();
  const question = useResource<Question>(
    current ? "/questions/" + current : null,
    3000,
    (value) => !value.outcome || value.support?.state === "creating",
  );
  useEffect(() => {
    if (question.value?.request_id === current) setEntries([question.value]);
  }, [question.value, current]);
  const active = Boolean(
    current &&
    (question.value?.request_id !== current || !question.value?.outcome),
  );
  const submit = async () => {
    if (sending || (!pending && active)) return;
    const draft = pending ?? { key: crypto.randomUUID(), text: text.trim() };
    if (!draft.text) return;
    setPending(draft);
    write(prefix + ":pending", draft);
    setEntries([]);
    setSending(true);
    setError(undefined);
    try {
      const result = await post<{ request_id: number }>(
        "/questions",
        { text: draft.text },
        draft.key,
      );
      setCurrent(result.request_id);
      write(prefix + ":request", result.request_id);
      setText("");
      setPending(null);
      write(prefix + ":pending", null);
    } catch (failure) {
      setError(failure);
      // A definite rejection cannot have registered this question. Ambiguous
      // network/5xx responses keep the same persisted key and body for retry.
      if (
        failure instanceof ApiError &&
        [401, 403, 409, 422].includes(failure.status)
      ) {
        setPending(null);
        write(prefix + ":pending", null);
      }
    } finally {
      setSending(false);
    }
  };
  const [supportError, setSupportError] = useState<unknown>(),
    [supportBusy, setSupportBusy] = useState<number>();
  async function startSupport(
    id: number,
    reason: "dissatisfied" | "human_request",
  ) {
    setSupportBusy(id);
    setSupportError(undefined);
    try {
      const support = await post<SupportCase>("/questions/" + id + "/support", {
        reason,
      });
      setEntries((previous) =>
        previous.map((item) =>
          item.request_id === id ? { ...item, support } : item,
        ),
      );
    } catch (failure) {
      setSupportError(failure);
    } finally {
      setSupportBusy(undefined);
    }
  }
  return (
    <section className="chat-page" aria-label="Чат с помощником">
      <div className="section-eyebrow">
        <span className="live-dot" /> ПОМОЩНИК ПО ДОКУМЕНТАЦИИ
      </div>
      {!me.admitted && (
        <p role="alert">
          Новые вопросы недоступны. Попросите администратора разрешить ваш
          Telegram username. Принятый ранее результат и собственные обращения
          остаются доступны.
        </p>
      )}
      {entries.length === 0 && !current && !pending && !sending && (
        <div className="welcome">
          <div className="welcome-orb">
            <Orb />
          </div>
          <span className="eyebrow">BARS ASSISTANT</span>
          <h1>Привет! Чем помочь?</h1>
          <p>
            Задайте вопрос по документации — я помогу найти ответ.
          </p>
          <div className="welcome-note">
            <Icon name="layers" />
            <span>
              Найдите нужное.
              <br />
              <strong>Разберитесь в деталях.</strong>
            </span>
          </div>
        </div>
      )}
      {(sending || (pending && !entries.length)) && (
        <div className="exchange">
          <div className="user-message">
            <span className="label">Вы</span>
            <p>{pending?.text}</p>
          </div>
          {sending && (
            <div className="bot-message">
              <p className="thinking" role="status">
                <Orb waiting /> Отправляем вопрос…
              </p>
            </div>
          )}
        </div>
      )}
      <div className="conversation" aria-live="polite">
        {entries.map((entry) => (
          <article className="exchange" key={entry.request_id}>
            <div className="user-message">
              <span className="label">Вы</span>
              <p>{entry.text}</p>
            </div>
            <div className="bot-message">
              <span className="label assistant-label">
                <Orb /> BARS Assistant
              </span>
              {!entry.outcome && !question.error ? (
                <p role="status" className="thinking">
                  <Orb waiting />
                  Обрабатываем вопрос… Можно закрыть приложение и вернуться
                  позже.
                </p>
              ) : entry.outcome?.kind === "answered" ? (
                <Answer result={entry.outcome.result} animate={visible} />
              ) : entry.outcome?.kind === "notice" ? (
                <p
                  role={
                    entry.outcome.code === "technical_error"
                      ? "alert"
                      : "status"
                  }
                >
                  {entry.outcome.text}
                </p>
              ) : entry.outcome ? (
                <p>
                  В документации не найден подтверждённый ответ. Обращение
                  передано в поддержку.
                </p>
              ) : null}
              {entry.support ? (
                <SupportPanel
                  initial={entry.support}
                  onTicket={onTicket}
                  poll={entry.request_id === current}
                />
              ) : (
                entry.outcome?.kind === "answered" && (
                  <div className="actions">
                    <button
                      disabled={supportBusy === entry.request_id}
                      onClick={() =>
                        void startSupport(entry.request_id, "dissatisfied")
                      }
                    >
                      <Icon name="chat" /> Ответ не помог
                    </button>
                    <button
                      disabled={supportBusy === entry.request_id}
                      onClick={() =>
                        void startSupport(entry.request_id, "human_request")
                      }
                    >
                      <Icon name="headset" /> Позвать оператора
                    </button>
                  </div>
                )
              )}
            </div>
          </article>
        ))}
      </div>
      {current && !question.value && question.loading && (
        <p role="status">Восстанавливаем вопрос…</p>
      )}
      {Boolean(question.error) && (
        <p role="alert">
          {errorText(question.error)}{" "}
          <button onClick={question.reload}>Обновить вопрос</button>
          {question.error instanceof ApiError &&
            question.error.status === 404 && (
              <button
                onClick={() => {
                  setCurrent(null);
                  write(prefix + ":request", null);
                }}
              >
                Начать новый вопрос
              </button>
            )}
        </p>
      )}
      {Boolean(supportError) && <p role="alert">{errorText(supportError)}</p>}
      {pending && (
        <p role="status">
          Отправка ещё не подтверждена. Повтор использует тот же ключ и не
          создаст второй вопрос.
        </p>
      )}
      <SupportInbox onTicket={onTicket} />
      <form
        className="composer question-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="question">
          Ваш вопрос
        </label>
        <textarea
          id="question"
          value={text}
          maxLength={16000}
          required
          disabled={
            sending || Boolean(pending) || (!pending && active) || !me.admitted
          }
          onChange={(event) => setText(event.target.value)}
          rows={2}
          placeholder="Задайте вопрос…"
        />
        <div className="actions">
          <button
            type="submit"
            className="primary send-button"
            aria-label={
              sending
                ? "Отправляем…"
                : pending
                  ? "Повторить отправку"
                  : "Отправить"
            }
            disabled={
              sending ||
              (!pending && active) ||
              (!me.admitted && !pending) ||
              (!pending && !text.trim())
            }
          >
            <Icon name="send" />
            <span className="sr-only">
              {sending
                ? "Отправляем…"
                : pending
                  ? "Повторить отправку"
                  : "Отправить"}
            </span>
          </button>
        </div>
        {Boolean(error) && <p role="alert">{errorText(error)}</p>}
      </form>
    </section>
  );
}
