import { useEffect, useState } from "react";
import { useResource } from "./useResource";
import { errorText } from "./api";
import { Icon } from "./UI";
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
    const viewport = () => {
      const sdk = telegram as unknown as {
        viewportHeight?: number;
        safeAreaInset?: { top: number; bottom: number };
        contentSafeAreaInset?: { top: number; bottom: number };
      };
      for (const edge of ["top", "bottom"] as const) {
        document.documentElement.style.setProperty(
          "--tg-content-safe-area-inset-" + edge,
          (sdk.safeAreaInset?.[edge] ?? 0) +
            (sdk.contentSafeAreaInset?.[edge] ?? 0) +
            "px",
        );
      }
      const height = Math.min(
        window.visualViewport?.height ?? window.innerHeight,
        sdk.viewportHeight || window.innerHeight,
      );
      document.documentElement.style.setProperty("--app-height", height + "px");
    };
    viewport();
    telegram.ready();
    telegram.expand();
    telegram.onEvent("viewportChanged", viewport);
    telegram.onEvent("safeAreaChanged", viewport);
    telegram.onEvent("contentSafeAreaChanged", viewport);
    window.addEventListener("resize", viewport);
    window.visualViewport?.addEventListener("resize", viewport);
    return () => {
      telegram.offEvent("viewportChanged", viewport);
      telegram.offEvent("safeAreaChanged", viewport);
      telegram.offEvent("contentSafeAreaChanged", viewport);
      window.removeEventListener("resize", viewport);
      window.visualViewport?.removeEventListener("resize", viewport);
    };
  }, []);
  if (!user.value)
    return (
      <main className="auth-state">
        <span className="brand-mark" />
        <h1>BARS Assistant</h1>
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
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <strong>BARS Assistant</strong>
            <span>Ответы по документации</span>
          </div>
        </div>
        <div className="account">
          <span>
            @{me.username ?? "без username"}
            <small>{admin ? "Администратор" : "Пользователь"}</small>
          </span>
          <button
            className="icon-button"
            aria-label="Обновить доступ"
            onClick={user.reload}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </header>
      <nav className="app-nav" aria-label="Разделы приложения">
        {[
          ["chat", "Чат-бот", "chat"],
          ["tickets", "Мои обращения", "tickets"],
          ...(admin
            ? [
                ["allTickets", "Очередь обращений", "headset"],
                ["users", "Допуски", "users"],
                ["metrics", "Метрики", "chart"],
              ]
            : []),
        ].map(([key, label, icon]) => (
          <button
            aria-current={tab === key ? "page" : undefined}
            key={key}
            onClick={() => setTab(key)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className={tab === "allTickets" ? "app-main wide" : "app-main"}>
        <div hidden={tab !== "chat"}>
          <Chat
            key={me.user_id}
            visible={tab === "chat"}
            me={me}
            onTicket={openTicket}
          />
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
