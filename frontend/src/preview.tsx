import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Answer } from "./Markdown";
import { Orb, Icon } from "./UI";
import type { RagResult } from "./types";
import "./style.css";

// Isolated Vite development entry. This file is not imported by the application.
const imageId = "11111111-1111-4111-8111-111111111111";
let imageFailure = false;
const originalFetch = window.fetch.bind(window);
if (import.meta.env.DEV)
  window.fetch = (input, init) => {
    if (String(input) === "/api/v1/images/" + imageId) {
      return imageFailure
        ? Promise.resolve(new Response("fixture image error", { status: 503 }))
        : originalFetch("/preview/diagram.svg", { signal: init?.signal });
    }
    return originalFetch(input, init);
  };
const markdown = [
  "# Сложный Markdown: проверка отображения",
  "Это **готовый отформатированный ответ**, а не поток символов. Здесь есть *курсив*, ~~зачёркивание~~, **жирный текст с `inline code`** и [ссылка на справку Telegram](https://core.telegram.org/bots/webapps).",
  "## Список с вложенностью",
  "1. Откройте раздел интеграции.\n   - Укажите адрес сервиса.\n   - Проверьте **сертификат**.\n2. Выполните тестовый запрос.\n3. Сохраните результат проверки.",
  "### Список задач",
  "- [x] Проверить Markdown\n- [x] Сохранить форматирование\n- [ ] Проверить результат в Telegram",
  "> **Важно**\n>\n> Это изолированный визуальный стенд. Примеры не являются инструкцией по настройке реальной системы.",
  "## Широкая таблица",
  "| Параметр | Тип | Обязательный | Описание | Пример значения |\n| :--- | :---: | :---: | :--- | ---: |\n| `endpoint` | string | Да | Адрес сервиса интеграции | https://example.org/integration/service/endpoint |\n| `timeout` | integer | Нет | Ожидание ответа в секундах | 30 |\n| `certificate` | string | Да | Идентификатор сертификата | demo-certificate-2026 |",
  "## Блок кода",
  '```python\nfrom dataclasses import dataclass\n\n@dataclass\nclass Connection:\n    endpoint: str\n    timeout: int = 30\n\nconnection = Connection(endpoint="https://example.org/very/long/path/to/integration/service/endpoint")\nprint(connection)\n```',
  "Код и таблица появляются **целиком**, сохраняя форматирование и горизонтальную прокрутку.",
  "---",
  "## Изображение из ответа",
  `![Схема обработки вопроса](image://${imageId})`,
  "Изображение отображается в защищённой галерее **под Markdown-ответом**. Нажмите на миниатюру для увеличения. Маркер `image://` не должен показываться в тексте.",
].join("\n\n");
const result: RagResult = {
  answer_text: markdown,
  sources: [],
  images: [
    {
      image_id: imageId,
      description: "Тестовая схема: вопрос → поиск → ответ",
    },
  ],
};
function Preview() {
  const [run, setRun] = useState(0),
    [waiting, setWaiting] = useState(true),
    [failure, setFailure] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setWaiting(true);
    const timer = setTimeout(() => setWaiting(false), 1400);
    return () => clearTimeout(timer);
  }, [run]);
  function replay(fail = failure) {
    imageFailure = fail;
    setFailure(fail);
    setWaiting(true);
    setRun((value) => value + 1);
    area.current?.scrollTo({ top: 0 });
  }
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <strong>BARS Assistant</strong>
            <span>Изолированная проверка интерфейса</span>
          </div>
        </div>
      </header>
      <main
        className="preview-page"
        ref={area}
        style={{ overflowY: "auto", padding: "24px 16px", flex: 1 }}
      >
        <div style={{ maxWidth: 780, margin: "auto" }}>
          <h1>Markdown, анимация и изображения</h1>
          <p className="muted">
            Тестовые данные. Реальный backend и модели не вызываются. Компоненты
            ответа и галереи — из приложения.
          </p>
          <div className="actions" style={{ marginBottom: 20 }}>
            <button className="primary" onClick={() => replay(false)}>
              <Icon name="refresh" /> Повторить анимацию
            </button>
            <button onClick={() => replay(true)}>
              Проверить ошибку картинки
            </button>
            {failure && (
              <button
                onClick={() => {
                  imageFailure = false;
                  setFailure(false);
                }}
              >
                Восстановить загрузку
              </button>
            )}
          </div>
          {window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && (
            <p role="status">
              В системе включено сокращение анимации. Ответ показывается сразу.
            </p>
          )}
          <article className="bot-message" key={run}>
            <span className="label assistant-label">
              <Orb /> BARS Assistant
            </span>
            {waiting ? (
              <p className="thinking" role="status">
                <Orb waiting /> Ищу ответ по документации…
              </p>
            ) : (
              <Answer result={result} animate />
            )}
          </article>
          <p className="muted page-note">
            После анимации прокрутите ответ вниз: там находятся таблица, код и
            галерея. При проверке ошибки нажмите «Повторить анимацию», чтобы
            восстановить тестовое изображение.
          </p>
        </div>
      </main>
    </>
  );
}
if (import.meta.env.DEV)
  createRoot(document.getElementById("root")!).render(<Preview />);
