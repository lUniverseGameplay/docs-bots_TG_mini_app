import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export function useResource<T>(
  path: string | null,
  interval = 0,
  keepPolling?: (value: T) => boolean,
) {
  const [value, setValue] = useState<T>(),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  const condition = useRef(keepPolling);
  condition.current = keepPolling;
  const previousPath = useRef(path);
  useEffect(() => {
    if (previousPath.current !== path) {
      setValue(undefined);
      previousPath.current = path;
    }
    setError(undefined);
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const load = async () => {
      setLoading(true);
      let delay = interval;
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setValue(result);
        setError(undefined);
        failures = 0;
        if (condition.current && !condition.current(result)) delay = 0;
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure);
        failures++;
        if (
          failure instanceof ApiError &&
          [401, 403, 404, 422].includes(failure.status)
        )
          delay = 0;
        else if (interval)
          delay = Math.max(
            interval,
            Math.min(30000, 2000 * 2 ** Math.min(failures, 4)),
            failure instanceof ApiError ? failure.retryAfter * 1000 : 0,
          );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (delay) timer = setTimeout(load, delay);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, interval, version]);
  return { value, error, loading, reload: () => setVersion((n) => n + 1) };
}
