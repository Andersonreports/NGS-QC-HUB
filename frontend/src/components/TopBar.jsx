import { useEffect, useRef, useState } from "react";
import { ROLES } from "../workflow";
import { Icon, timeAgo } from "./ui";

/**
 * Three clearly separate zones:
 *   dark brand bar  — the app name, centred, with who's signed in on the right
 *   white tab bar   — navigation, centred
 *   (page content on the slate background below)
 */
export default function TopBar({ user, tabs, activeTab, onTab, notifications, onMarkAllRead, onOpenRun, onLogout }) {
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const unread = notifications.filter((n) => !n.read).length;
  const role = ROLES[user.role];
  const initials = (user.full_name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    function onClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-40 shadow-md shadow-slate-900/5">
      {/* ---------- brand bar ---------- */}
      <div className="bg-brand-900 text-white">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="h-[4.5rem] flex items-center gap-3">
            {/* balances the controls on the right so the title sits dead centre */}
            <div className="flex-1" />

            <div className="flex items-center gap-3 shrink-0">
              <div className="w-11 h-11 rounded-xl bg-accent-600 flex items-center justify-center shadow-lg shadow-brand-950/60">
                <Icon name="flask" size={22} />
              </div>
              <div className="text-left">
                <div className="text-[1.35rem] font-extrabold tracking-tight leading-none">NGS QC Hub</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-200/70 mt-1.5">
                  Anderson Diagnostics
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-end gap-2">
              {/* who's signed in — contained, so it reads as an identity, not stray text */}
              <div className="hidden sm:flex items-center gap-2.5 bg-white/[0.08] border border-white/10 rounded-full pl-1.5 pr-4 py-1.5">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0"
                  style={{ background: role?.soft, color: role?.color }}
                >
                  {initials}
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-bold">{user.full_name}</span>
                  <span
                    className="block text-[10.5px] font-bold uppercase tracking-wide"
                    style={{ color: role?.onDark }}
                  >
                    {role?.label}
                  </span>
                </span>
              </div>

              <span className="hidden sm:block w-px h-8 bg-white/10 mx-1" />

              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setBellOpen((o) => !o)}
                  className="relative w-10 h-10 rounded-lg text-brand-100 hover:bg-white/15 hover:text-white flex items-center justify-center transition-colors"
                  aria-label="Notifications"
                >
                  <Icon name="bell" size={19} />
                  {unread > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-accent-700 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-brand-900">
                      {unread}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div className="absolute right-0 top-12 w-[min(23rem,calc(100vw-2rem))] bg-white text-slate-900 rounded-xl border border-slate-200 shadow-xl overflow-hidden fade-up">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                      <span className="text-sm font-bold">Notifications</span>
                      {unread > 0 && (
                        <button
                          className="text-xs font-bold text-brand-700 hover:text-brand-900"
                          onClick={onMarkAllRead}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => {
                              setBellOpen(false);
                              onOpenRun(n);
                            }}
                            className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${
                              n.kind === "qc_fail" ? "bg-red-50" : n.read ? "" : "bg-brand-50/60"
                            }`}
                          >
                            <div className={`text-sm ${n.kind === "qc_fail" ? "font-semibold text-red-700" : "text-slate-800"}`}>
                              {n.text}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.created_at)}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={onLogout}
                className="w-10 h-10 rounded-lg text-brand-100 hover:bg-white/15 hover:text-white flex items-center justify-center transition-colors"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icon name="logout" size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- tab bar (skipped when a role has only one screen) ---------- */}
      {tabs.length > 1 && (
      <div className="bg-white border-b border-slate-200">
        <nav className="w-full px-4 sm:px-6 lg:px-8 flex justify-center gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`relative px-5 py-3 text-sm font-bold whitespace-nowrap transition-colors
                  border-b-[3px] -mb-px ${
                    active
                      ? "border-accent-600 text-accent-700"
                      : "border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
              >
                {t.label}
                {t.badge > 0 && (
                  <span
                    className={`ml-2 inline-flex items-center justify-center min-w-[1.2rem] h-[1.2rem] text-[11px] font-extrabold rounded-full px-1 ${
                      active ? "bg-accent-600 text-white" : "bg-accent-800 text-white"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      )}
    </header>
  );
}
