export interface Me {
  user_id: number;
  username: string | null;
  role: "user" | "admin";
  admitted: boolean;
  active_request_id: number | null;
  capabilities: { image_uploads: boolean };
}
export interface ImageRef {
  image_id: string;
  description: string;
}
export interface Source {
  document_id: string;
  chunk_id: string;
  source_name: string;
  locator?: { page?: number; section?: string } | null;
}
export interface RagResult {
  answer_text: string;
  images: ImageRef[];
  sources: Source[];
}
export type Outcome =
  | { kind: "answered"; result: RagResult }
  | { kind: "notice"; code: string; text: string }
  | { kind: "support"; reason: string };
export interface SupportCase {
  case_id: string;
  request_id: number;
  user_id: number;
  state:
    | "waiting"
    | "awaiting_confirmation"
    | "creating"
    | "open"
    | "closed"
    | "cancelled";
  reason: string;
  check_at: string | null;
  created_at: string | null;
  closed_at: string | null;
  ticket_url: string | null;
}
export interface Question {
  request_id: number;
  state: string;
  text: string;
  outcome: Outcome | null;
  support: SupportCase | null;
  received_at: string;
}
export interface TicketMessage {
  message_id: number;
  author_role: "visitor" | "operator";
  author_login: string | null;
  text: string;
  created_at: string;
}
export interface TicketView {
  case: SupportCase;
  history: {
    question_text: string;
    answer_text: string | null;
    outcome: string;
  }[];
  messages: TicketMessage[];
  next_cursor: number | null;
}
export interface Page<T> {
  items: T[];
  next_cursor: number | string | null;
}
export interface TelegramApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  onEvent: (event: string, callback: () => void) => void;
  offEvent: (event: string, callback: () => void) => void;
  colorScheme: string;
  themeParams: Record<string, string>;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
