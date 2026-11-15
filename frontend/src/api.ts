export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "local_rag_disabled")
      return "Локальный стенд запущен без моделей. Ответы RAG отключены.";
    if (error.status === 401)
      return "Сессия Telegram истекла или не подтверждена. Закройте и заново откройте приложение из Telegram.";
    if (error.status === 403)
      return "Доступ к этому действию запрещён. Обратитесь к администратору.";
    if (error.status === 404) return "Запись не найдена или недоступна.";
    if (error.code === "active_question_exists")
      return "Предыдущий вопрос ещё обрабатывается. Дождитесь ответа.";
    if (error.status === 409)
      return "Действие конфликтует с текущим состоянием. Обновите данные и повторите.";
    if (error.status === 429)
      return "Слишком много запросов. Подождите и повторите.";
    if (error.status === 501)
      return "Приём изображений появится в следующей версии.";
    if (error.status === 422) return "Проверьте заполненные поля.";
  }
  return "Не удалось связаться с сервером. Повторите запрос: принятый вопрос продолжит обрабатываться.";
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new ApiError(401, "telegram_auth_required");
  const response = await fetch("/api/v1" + path, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: "tma " + initData,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let code = "http_error";
    try {
      code = (await response.json()).detail ?? code;
    } catch {}
    throw new ApiError(
      response.status,
      code,
      Number(response.headers.get("Retry-After") ?? 0),
    );
  }
  return (await response.json()) as T;
}
export async function imageBlob(
  id: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch("/api/v1/images/" + encodeURIComponent(id), {
    signal,
    cache: "no-store",
    headers: {
      Authorization: "tma " + (window.Telegram?.WebApp?.initData ?? ""),
    },
  });
  if (!response.ok) throw new ApiError(response.status, "image_unavailable");
  return response.blob();
}
export const post = <T>(path: string, body?: unknown, key?: string) =>
  api<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(key ? { headers: { "Idempotency-Key": key } } : {}),
  });
