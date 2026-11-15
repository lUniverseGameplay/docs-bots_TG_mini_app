import type { ReactNode } from "react";
import type { SupportCase } from "./types";
import { stateLabels } from "./Support";

const paths: Record<string, ReactNode> = {
  chat: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
    </>
  ),
  tickets: (
    <>
      <rect x="3" y="3" width="16" height="13" rx="3" />
      <path d="m7 16-2 5 7-5m10-9v10a3 3 0 0 1-3 3h-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-2a7 7 0 0 1 14 0v2m1-17a4 4 0 0 1 0 8m3 9v-2a7 7 0 0 0-2-5" />
    </>
  ),
  headset: (
    <>
      <path d="M3 14v-3a9 9 0 0 1 18 0v3m-4 7h1a3 3 0 0 0 3-3" />
      <rect x="2" y="11" width="5" height="8" rx="2" />
      <rect x="17" y="11" width="5" height="8" rx="2" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13" />
    </>
  ),
  arrow: <path d="m15 18-6-6 6-6M9 12h12" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  chart: <path d="M4 3v18h17M8 16v-4m5 4V7m5 9V4" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  layers: (
    <>
      <path d="m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.chat}
    </svg>
  );
}
export function Orb({ waiting = false }: { waiting?: boolean }) {
  return (
    <span
      className={waiting ? "orb-group waiting" : "orb-group"}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
export function StatusBadge({ state }: { state: SupportCase["state"] }) {
  return (
    <span className={"status-badge status-" + state}>{stateLabels[state]}</span>
  );
}
export function PageHeading({
  title,
  description,
  icon = "tickets",
  children,
}: {
  title: string;
  description?: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="heading-icon">
        <Icon name={icon} />
      </div>
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
