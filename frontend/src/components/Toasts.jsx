import { Icon } from "./ui";

/** Floating notification stack, bottom-right. */
export default function Toasts({ toasts, onDismiss, onOpen }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 w-[min(26rem,calc(100vw-2.5rem))]">
      {toasts.map((t) => {
        const accent =
          t.kind === "qc_fail"
            ? "border-l-red-600"
            : t.kind === "error"
            ? "border-l-accent-800"
            : t.kind === "notification"
            ? "border-l-accent-600"
            : "border-l-brand-600";
        const iconColor =
          t.kind === "qc_fail"
            ? "text-red-600"
            : t.kind === "error" || t.kind === "notification"
            ? "text-accent-700"
            : "text-brand-600";
        return (
          <div
            key={t.id}
            className={`toast-in card border-l-4 ${accent} shadow-lg px-4 py-3 flex items-start gap-3 ${
              t.kind === "qc_fail" ? "bg-red-50" : ""
            }`}
          >
            <Icon
              name={t.kind === "error" || t.kind === "qc_fail" ? "x" : t.kind === "success" ? "check" : "bell"}
              size={17}
              className={`mt-0.5 shrink-0 ${iconColor}`}
              strokeWidth={2.2}
            />
            <div className="flex-1 min-w-0">
              {t.title && (
                <div className={`text-sm font-bold ${t.kind === "qc_fail" ? "text-red-700" : ""}`}>{t.title}</div>
              )}
              <div className={`text-sm break-words ${t.kind === "qc_fail" ? "text-red-700 font-semibold" : "text-slate-700"}`}>
                {t.text}
              </div>
              {t.runNumber && onOpen && (
                <button
                  onClick={() => {
                    onOpen(t.runNumber);
                    onDismiss(t.id);
                  }}
                  className="mt-1.5 text-xs font-bold text-brand-700 hover:text-brand-900"
                >
                  Open run {t.runNumber} →
                </button>
              )}
            </div>
            <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-700 shrink-0">
              <Icon name="x" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
