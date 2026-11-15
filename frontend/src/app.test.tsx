import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Tickets } from "./Tickets";
import { Users } from "./Admin";
import App from "./App";
import { Chat } from "./Chat";
import { Answer, Markdown, MarkdownReveal } from "./Markdown";
import { SupportPanel, SupportInbox } from "./Support";
import type { Me, Question, SupportCase } from "./types";

const me: Me = {
  user_id: 7,
  username: "alice",
  role: "user",
  admitted: true,
  active_request_id: null,
  capabilities: { image_uploads: false },
};
const imageId = "11111111-1111-4111-8111-111111111111";
const question: Question = {
  request_id: 17,
  state: "finished",
  text: "How?",
  received_at: "2026-11-15T10:00:00Z",
  support: null,
  outcome: {
    kind: "answered",
    result: {
      answer_text:
        "# Answer\n\n*Italic* and **bold**\n\n```python\n  print(1)\n```",
      sources: [],
      images: [],
    },
  },
};
const support: SupportCase = {
  case_id: "22222222-2222-4222-8222-222222222222",
  request_id: 17,
  user_id: 7,
  state: "awaiting_confirmation",
  reason: "human_request",
  check_at: "2026-11-15T10:10:00Z",
  created_at: null,
  closed_at: null,
  ticket_url: null,
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => {
  localStorage.clear();
  window.Telegram = {
    WebApp: {
      initData: "signed-fixture",
      ready: vi.fn(),
      expand: vi.fn(),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      colorScheme: "light",
      themeParams: { bg_color: "#ffffff" },
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Markdown and response images", () => {
  it("hides service markers even inside code and preserves surrounding code", () => {
    const { container } = render(
      <Markdown
        text={
          "`before image://" +
          imageId +
          " after`\n\n```md\n![Description](image://" +
          imageId +
          ")\n```"
        }
        images={[{ image_id: imageId, description: "Diagram" }]}
      />,
    );
    expect(container.textContent).not.toContain("image://");
    expect(container.querySelector("code")?.textContent).toContain("before");
    expect(container.querySelector("pre")?.textContent).toContain(
      "Description",
    );
    expect(container.querySelector("pre")?.textContent).toContain(
      "[изображение ниже]",
    );
  });
  it("renders full GFM without executing HTML or loading inline images", () => {
    const { container } = render(
      <Markdown
        text={
          "# Heading\n\n*Italic* **bold** ~~removed~~ `inline`\n\n> quote\n\n- first\n- second\n\n1. one\n2. two\n\n| a | b |\n| - | - |\n| c | d |\n\n```js\n  const x = 1;\n```\n\n---\n\n<script>alert(1)</script>\n\n![Remote](https://attacker.example/image.png)\n\n[bad](javascript:alert(1))"
        }
      />,
    );
    for (const selector of [
      "h1",
      "em",
      "strong",
      "del",
      "code",
      "blockquote",
      "ul",
      "ol",
      "table",
      "pre",
      "hr",
    ])
      expect(container.querySelector(selector)).not.toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain(
      "  const x = 1;",
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).not.toContain(
      "javascript:",
    );
  });
  it("places authenticated gallery below Markdown, keeps descriptions and revokes Blob URLs", async () => {
    const create = vi.fn(() => "blob:fixture"),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const fetcher = vi.fn(
      async (_path: string, _options?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { container, unmount } = render(
      <Answer
        result={{
          answer_text: `Text before ![Diagram explanation](image://${imageId}) text after`,
          images: [{ image_id: imageId, description: "Diagram" }],
          sources: [],
        }}
      />,
    );
    await screen.findByRole("img", { name: "Diagram" });
    expect(container.querySelector(".markdown")?.textContent).toContain(
      "Diagram explanation",
    );
    expect(container.querySelector(".markdown")?.textContent).toContain(
      "text after",
    );
    expect(container.textContent).not.toContain("image://");
    expect(container.querySelector(".markdown img")).toBeNull();
    expect(
      Boolean(
        container
          .querySelector(".markdown")!
          .compareDocumentPosition(container.querySelector(".gallery")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/images/" + imageId);
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe(
      "tma signed-fixture",
    );
    fireEvent.click(screen.getByRole("button", { name: "Увеличить: Diagram" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:fixture");
  });
});

describe("roles, text chat and request recovery", () => {
  it("shows user screens, keeps upload disabled, sends only text and renders answer", async () => {
    const calls: { path: string; options: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit = {}) => {
        calls.push({ path, options });
        if (path.endsWith("/me")) return json(me);
        if (path === "/api/v1/questions") return json({ request_id: 17 }, 202);
        if (path.endsWith("/questions/17")) return json(question);
        throw Error(path);
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Привет! Чем помочь?" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Допуски" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /Прикрепить/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Ваш вопрос"), {
      target: { value: "How?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByRole("heading", { name: "Answer" });
    const sent = calls.find((call) => call.path === "/api/v1/questions")!;
    expect(JSON.parse(sent.options.body as string)).toEqual({ text: "How?" });
    expect(
      (sent.options.headers as Record<string, string>)["Idempotency-Key"],
    ).toBeTruthy();
    expect(calls.some((call) => call.path.includes("/uploads"))).toBe(false);
    expect(localStorage.getItem("docs-mini:7:request")).toBe("17");
  });
  it("preserves key and body across ambiguous failure and reopening", async () => {
    const keys: string[] = [];
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit = {}) => {
        if (path === "/api/v1/questions") {
          keys.push(
            (options.headers as Record<string, string>)["Idempotency-Key"],
          );
          if (attempt++ === 0) throw TypeError("network");
          return json({ request_id: 17 }, 202);
        }
        if (path.endsWith("/questions/17")) return json(question);
        throw Error(path);
      }),
    );
    const first = render(<Chat me={me} onTicket={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Ваш вопрос"), {
      target: { value: "How?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByRole("button", { name: "Повторить отправку" });
    first.unmount();
    const second = render(<Chat me={me} onTicket={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить отправку" }));
    await screen.findByRole("heading", { name: "Answer" });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    second.unmount();
    render(<Chat me={me} onTicket={vi.fn()} />);
    await screen.findByRole("heading", { name: "Answer" });
    expect(keys).toHaveLength(2);
  });
  it("does not expose admin navigation to users but includes all panels for admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.endsWith("/me")
          ? json({ ...me, role: "admin", admitted: false })
          : json({ items: [], next_cursor: null }),
      ),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Очередь обращений" });
    expect(screen.getByRole("button", { name: "Допуски" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Метрики" })).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("requires Telegram initData instead of a development username bypass", async () => {
    window.Telegram = undefined;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Telegram",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("support and ticket chat", () => {
  it("confirms a due persisted case and opens the created ticket", async () => {
    let confirmed = false;
    const open = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit = {}) => {
        if (options.method === "POST") {
          expect(path).toBe("/api/v1/support/" + support.case_id + "/confirm");
          confirmed = true;
          return json({ ...support, state: "creating" });
        }
        return json(
          confirmed
            ? {
                ...support,
                state: "open",
                created_at: "2026-11-15T11:00:00Z",
                ticket_url:
                  "https://rag.example.org/tickets/" + support.case_id,
              }
            : support,
        );
      }),
    );
    render(<SupportPanel initial={support} onTicket={open} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Помощь всё ещё нужна" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Открыть обращение" }),
    );
    expect(open).toHaveBeenCalledWith(support.case_id);
  });
  it("opens own ticket and sends a message with a server-owned author", async () => {
    let sent = false;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit = {}) => {
        if (path.endsWith("/me")) return json(me);
        if (path === "/api/v1/tickets")
          return json({
            items: [
              { ...support, state: "open", created_at: "2026-11-15T11:00:00Z" },
            ],
            next_cursor: null,
          });
        if (options.method === "POST") {
          bodies.push(JSON.parse(options.body as string));
          sent = true;
          return json({ message_id: 1 });
        }
        if (path.endsWith("/messages"))
          return json({
            case: { ...support, state: "open" },
            history: [
              {
                question_text: "Question",
                answer_text: "**Original answer**",
                outcome: "answered",
              },
            ],
            messages: sent
              ? [
                  {
                    message_id: 1,
                    author_role: "visitor",
                    author_login: null,
                    text: "Details",
                    created_at: "2026-11-15T11:00:00Z",
                  },
                ]
              : [],
            next_cursor: null,
          });
        throw Error(path);
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "Привет! Чем помочь?" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Мои обращения" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Обращение №17/ }),
    );
    await screen.findByLabelText("Сообщение");
    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Details" },
    });
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Отправить" })
        .find((button) =>
          button.closest("section")?.querySelector("#ticket-message"),
        )!,
    );
    await screen.findByText("Details");
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0] as object).sort()).toEqual([
      "client_message_id",
      "text",
    ]);
  });
  it("recovers pending support independently of the last question after reopening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/v1/support")
          return json({ items: [support], next_cursor: null });
        if (path.endsWith("/" + support.case_id)) return json(support);
        throw Error(path);
      }),
    );
    render(<SupportInbox onTicket={vi.fn()} />);
    fireEvent.click(screen.getByText("Ожидающие обращения поддержки"));
    fireEvent.click(await screen.findByRole("button", { name: /Вопрос №17/ }));
    expect(
      await screen.findByRole("button", { name: "Помощь всё ещё нужна" }),
    ).toBeDefined();
  });
});

describe("redesign interactions", () => {
  it("reveals complete Markdown blocks and lets the reader skip", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { container } = render(
      <MarkdownReveal
        text={"# Title\n\n**Complete bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe(
      "Complete bold",
    );
    expect(
      (container.querySelector("table") as HTMLElement).style.visibility,
    ).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Показать сразу" }));
    expect(
      (container.querySelector("table") as HTMLElement).style.visibility,
    ).toBe("visible");
    expect(screen.queryByRole("button", { name: "Показать сразу" })).toBeNull();
  });
  it("shows the full answer for reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const { container } = render(
      <MarkdownReveal text={"# Title\n\nSecond block"} />,
    );
    expect(
      (container.querySelector(".markdown p [data-reveal-unit]") as HTMLElement)
        .style.visibility,
    ).toBe("visible");
    expect(screen.queryByRole("button", { name: "Показать сразу" })).toBeNull();
  });
  it("removes the previous pair as soon as a new question is submitted", async () => {
    let request = 17;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, options: RequestInit = {}) => {
        if (path === "/api/v1/questions" && options.method === "POST")
          return json({ request_id: ++request }, 202);
        if (path.endsWith("/questions/17")) return json(question);
        if (path.endsWith("/questions/18"))
          return json({
            ...question,
            request_id: 18,
            text: "Next question",
            outcome: null,
          });
        return json({ items: [], next_cursor: null });
      }),
    );
    render(<Chat me={{ ...me, active_request_id: 17 }} onTicket={vi.fn()} />);
    await screen.findByRole("heading", { name: "Answer" });
    fireEvent.change(screen.getByLabelText("Ваш вопрос"), {
      target: { value: "Next question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(screen.queryByRole("heading", { name: "Answer" })).toBeNull();
    await screen.findByText("Next question");
    expect(screen.queryByText("How?")).toBeNull();
  });
});

describe("appeal filters and access actions", () => {
  it("filters loaded appeals by real API states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          items: [
            { ...support, state: "open" },
            {
              ...support,
              case_id: "closed-case",
              request_id: 18,
              state: "closed",
            },
          ],
          next_cursor: null,
        }),
      ),
    );
    render(<Tickets userId={7} selected={null} onSelect={vi.fn()} />);
    await screen.findByRole("button", { name: /Обращение №17/ });
    fireEvent.click(screen.getByRole("button", { name: /Закрытые/ }));
    expect(screen.queryByRole("button", { name: /Обращение №17/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Обращение №18/ })).toBeDefined();
  });
  it("does not revoke access when confirmation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetcher = vi.fn(async () =>
      json({
        items: [{ username: "alice", enabled: true }],
        next_cursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<Users />);
    fireEvent.click(await screen.findByRole("button", { name: "Отозвать" }));
    expect(confirm).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
  it("shows a forbidden error with retry instead of an empty screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "forbidden" }, 403)),
    );
    render(<Tickets userId={7} admin selected={null} onSelect={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeDefined();
  });
});

describe("image failure recovery", () => {
  it("shows an error, retries the protected image and closes zoom with Escape", async () => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:retried-image");
        static revokeObjectURL = vi.fn();
      },
    );
    let attempts = 0;
    const fetcher = vi.fn(async () =>
      ++attempts === 1
        ? new Response("failure", { status: 503 })
        : new Response(new Uint8Array([1, 2]), {
            headers: { "Content-Type": "image/png" },
          }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <Answer
        result={{
          answer_text: "**Answer**",
          images: [{ image_id: imageId, description: "Retry diagram" }],
          sources: [],
        }}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не удалось загрузить изображение",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку изображения" }),
    );
    await screen.findByRole("img", { name: "Retry diagram" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Увеличить: Retry diagram" }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("smooth bounded reveal", () => {
  it("reveals phrases without collapsing layout and finishes within 4.5 seconds", () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      const { container } = render(
        <MarkdownReveal
          text={
            "# Heading\n\nFirst second third fourth fifth sixth **bold words** [safe link](https://example.org)\n\n```js\nconst a = 1;\n```"
          }
        />,
      );
      expect(container.querySelector(".reveal-cursor")?.tagName).toBe("H1");
      expect(
        (container.querySelector("pre") as HTMLElement).style.visibility,
      ).toBe("hidden");
      expect((container.querySelector("pre") as HTMLElement).hidden).toBe(
        false,
      );
      act(() => vi.advanceTimersByTime(180));
      expect(container.querySelector(".reveal-cursor")?.textContent).toBe(
        "First second third ",
      );
      expect(container.querySelector("strong")?.textContent).toBe("bold words");
      act(() => vi.advanceTimersByTime(4500));
      expect(container.querySelector(".reveal-cursor")).toBeNull();
      expect(
        (container.querySelector("pre") as HTMLElement).style.visibility,
      ).toBe("visible");
    } finally {
      vi.useRealTimers();
    }
  });
});
