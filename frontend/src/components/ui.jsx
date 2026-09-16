import { ROLES, STAGE_BY_ID } from "../workflow";

const ICON_PATHS = {
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6L6 18",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
  bell: "M12 2a5 5 0 0 0-5 5v3.3c0 1.2-2 3.2-2 3.7h14c0-.5-2-2.5-2-3.7V7a5 5 0 0 0-5-5z M9.5 17a2.5 2.5 0 0 0 5 0",
  file: "M7 2.5h6l5 5v14h-12z M13 2.5v5h5 M9.5 12h5 M9.5 15.5h5",
  clock: "M12 7v5l3 3 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  flask: "M9.5 2.5h5 M10.3 2.5v6.2l-5 9.3a2 2 0 0 0 1.8 2.9h9.8a2 2 0 0 0 1.8-2.9l-5-9.3V2.5 M8 15h8",
  logout: "M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4 M16 17l5-5-5-5 M21 12H9",
  arrowLeft: "M19 12H5 M11 18l-6-6 6-6",
  plus: "M12 5v14M5 12h14",
  users: "M2.5 20c0-3.3 3-5.5 6.5-5.5s6.5 2.2 6.5 5.5 M9 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M16 9a2.6 2.6 0 1 0 0-5.2 M16.3 14.6c2.4.3 4.7 2.1 4.7 5.4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 8v.01",
  refresh: "M4 12a8 8 0 0 1 14-5.3L21 9 M21 4v5h-5 M20 12a8 8 0 0 1-14 5.3L3 15 M3 20v-5h5",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  panelLeft: "M4 4h16v16H4z M10 4v16",
  pin: "M12 21s-6.5-6.3-6.5-10.8a6.5 6.5 0 1 1 13 0C18.5 14.7 12 21 12 21z M12 12.7a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
};

export function Icon({ name, size = 18, className = "", strokeWidth = 1.8 }) {
  const paths = (ICON_PATHS[name] || "").split(/(?=M)/).filter(Boolean);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function RoleChip({ role }) {
  const r = ROLES[role];
  if (!r) return null;
  return (
    <span className="chip" style={{ background: r.soft, color: r.color }}>
      {r.label}
    </span>
  );
}

export function StatusChip({ run }) {
  if (run.status === "completed") {
    return <span className="chip bg-emerald-100 text-emerald-800">Completed</span>;
  }
  const last = run.history?.[run.history.length - 1];
  if (last?.action === "rejected") {
    return <span className="chip bg-red-100 text-red-800">Sent back</span>;
  }
  return <span className="chip bg-amber-100 text-amber-800">In progress</span>;
}

export function StageChip({ stageId }) {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return null;
  return (
    <span className="chip bg-slate-100 text-slate-700">
      {stage.title}
    </span>
  );
}

export function Spinner({ className = "" }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Alert({ kind = "info", children, onDismiss }) {
  const styles = {
    info: "bg-brand-50 text-brand-900 border-brand-200",
    success: "bg-emerald-50 text-emerald-900 border-emerald-200",
    error: "bg-red-50 text-red-900 border-red-200",
    warn: "bg-amber-50 text-amber-900 border-amber-200",
  }[kind];
  return (
    <div className={`flex items-start gap-2.5 border rounded-lg px-3.5 py-3 text-sm ${styles}`}>
      <Icon name={kind === "success" ? "check" : kind === "error" ? "x" : "info"} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-60 hover:opacity-100">
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}

export function formatDateTime(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function timeAgo(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Whole days elapsed since an ISO timestamp — used for the "N days since transfer" reminder. */
export function daysSince(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
