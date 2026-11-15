import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/sources": "http://127.0.0.1:8080",
      "^/telegram/webhook$": "http://127.0.0.1:8000",
      "^/tickets(?:/|$)": "http://127.0.0.1:8000",
      "^/admin(?:/|$)": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8080",
    },
  },
  test: { environment: "jsdom", restoreMocks: true },
});
