import { useEffect, useState } from "react";
import { useResource } from "./useResource";
import { errorText } from "./api";
import { Chat } from "./Chat";
import { Tickets } from "./Tickets";
import { Users, Metrics } from "./Admin";
import type { Me } from "./types";

export default function App() {
  const user = useResource<Me>("/me");
  const [tab, setTab] = useState("chat"),
    [ticket, setTicket] = useState<string | null>(null),
    [adminTicket, setAdminTicket] = useState<string | null>(null);
  useEffect(() => {
    if (
      user.value?.role === "user" &&
      ["allTickets", "users", "metrics"].includes(tab)
    )
      setTab("chat");
  }, [user.value?.role, tab]);
  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    if (!telegram) return;
    const theme = () => {
      document.documentElement.dataset.theme = telegram.colorScheme;
      for (const [key, value] of Object.entries(telegram.themeParams)) {
        if (/^#[0-9a-fA-F]{6}$/.test(value))
          document.documentElement.style.setProperty(
            "--tg-" + key.replaceAll("_", "-"),
            value,
          );
      }
    };
    theme();
    telegram.ready();
    telegram.expand();
    telegram.onEvent("themeChanged", theme);
    return () => telegram.offEvent("themeChanged", theme);
  }, []);
  if (!user.value)
    return (
      <main>
        <h1>Помощник по документации</h1>
        {user.error ? (
          <>
            <p role="alert">{errorText(user.error)}</p>
            <button onClick={user.reload}>Повторить</button>
          </>
        ) : (
          <p role="status">Проверяем доступ через Telegram…</p>
        )}
      </main>
    );
  const me = user.value,
    admin = me.role === "admin";
  const openTicket = (id: string) => {
    setTicket(id);
    setTab("tickets");
  };
  return (
    <>
      <header>
        <span>@{me.username ?? "без username"}</span>
        <span>{admin ? "Администратор" : "Пользователь"}</span>
        <button onClick={user.reload}>Обновить доступ</button>
      </header>
      <nav aria-label="Разделы приложения">
        {[
          ["chat", "Чат"],
          ["tickets", "Мои тикеты"],
          ...(admin
            ? [
                ["allTickets", "Все тикеты"],
                ["users", "Допуск"],
                ["metrics", "Метрики"],
              ]
            : []),
        ].map(([key, label]) => (
          <button
            aria-current={tab === key ? "page" : undefined}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        <div hidden={tab !== "chat"}>
          <Chat key={me.user_id} me={me} onTicket={openTicket} />
        </div>
        {tab === "tickets" && (
          <Tickets userId={me.user_id} selected={ticket} onSelect={setTicket} />
        )}
        {admin && tab === "allTickets" && (
          <Tickets
            userId={me.user_id}
            admin
            selected={adminTicket}
            onSelect={setAdminTicket}
          />
        )}
        {admin && tab === "users" && <Users onAccessChanged={user.reload} />}
        {admin && tab === "metrics" && <Metrics />}
      </main>
    </>
  );
}
