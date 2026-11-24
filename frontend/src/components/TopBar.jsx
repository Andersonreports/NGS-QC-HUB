import { useEffect, useRef, useState } from "react";
import { ROLES } from "../workflow";
import { Icon, timeAgo } from "./ui";
import { ORGS, currentOrgId } from "../orgs";

/**
 * Three clearly separate zones:
 *   dark brand bar  — the app name, centred, with who's signed in on the right
 *   white tab bar   — navigation, centred
 *   (page content on the slate background below)
 */
export default function TopBar({
  user,
  isAdmin = false,
  actingRole,
  onActingRole,
  tabs,
  activeTab,
  onTab,
  notifications,
  onMarkAllRead,
  onOpenRun,
  onLogout,
}) {
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
    <header className="sticky top-0 z-40 shadow-lg shadow-brand-950/20">
      {/* ---------- brand bar ---------- */}
      <div className="relative z-20 text-white bg-gradient-to-r from-brand-950 via-brand-800 to-brand-600">
        {/* soft glows + accent hairline for depth */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 left-1/4 w-72 h-72 rounded-full bg-brand-300/20 blur-3xl" />
          <div className="absolute -bottom-20 right-10 w-64 h-64 rounded-full bg-accent-500/25 blur-3xl" />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-accent-400 to-transparent" />
        <div className="relative w-full px-4 sm:px-6 lg:px-8">
          <div className="h-14 sm:h-[4.5rem] flex items-center gap-2 sm:gap-3">
            {/* balances the controls on the right so the title sits dead centre */}
            <div className="hidden md:block flex-1" />

            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 md:flex-none">
              <div className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-xl sm:rounded-2xl bg-gradient-to-br from-accent-400 to-accent-700 ring-1 ring-white/30 flex items-center justify-center shadow-lg shadow-accent-900/40">
                <Icon name="flask" size={22} />
              </div>
              <div className="text-left min-w-0">
                <div className="text-[0.95rem] min-[420px]:text-base sm:text-xl lg:text-[1.35rem] font-extrabold tracking-tight leading-tight sm:leading-none truncate bg-gradient-to-r from-white to-brand-100 bg-clip-text text-transparent">Germline Exome QC Hub</div>
                <div className="hidden min-[420px]:block text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.16em] text-accent-200 mt-1 sm:mt-1.5 truncate">
                  Anderson Diagnostics · {ORGS[currentOrgId()]?.name}
                </div>
              </div>
            </div>

            <div className="md:flex-1 shrink-0 flex items-center justify-end gap-1 sm:gap-2">
              {/* who's signed in — contained, so it reads as an identity, not stray text */}
              <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur border border-white/20 rounded-full pl-1 pr-1 lg:pl-1.5 lg:pr-4 py-1 lg:py-1.5 shadow-inner">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0"
                  style={{ background: role?.soft, color: role?.color }}
                >
                  {initials}
                </span>
                <span className="hidden lg:block leading-tight">
                  <span className="block text-[13px] font-bold">{user.full_name}</span>
                  <span
                    className="block text-[10.5px] font-bold uppercase tracking-wide"
                    style={{ color: role?.onDark }}
                  >
                    {role?.label}
                  </span>
                </span>
              </div>

              <span className="hidden lg:block w-px h-8 bg-white/10 mx-1" />

              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setBellOpen((o) => !o)}
                  className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg text-brand-100 hover:bg-white/15 hover:text-white flex items-center justify-center transition-colors"
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
                  <div className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-[3.75rem] sm:top-12 sm:w-[23rem] bg-white text-slate-900 rounded-xl border border-slate-200 shadow-xl overflow-hidden fade-up z-50">
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
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg text-brand-100 hover:bg-white/15 hover:text-white flex items-center justify-center transition-colors"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icon name="logout" size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- admin role switcher ---------- */}
      {isAdmin && (
        <div className="bg-brand-800 text-white border-b border-white/10">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2 flex items-center sm:justify-center gap-2 overflow-x-auto whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wide text-accent-200 mr-1">
              <Icon name="users" size={13} /> Admin · testing as
            </span>
            {Object.keys(ROLES).map((rid) => {
              const r = ROLES[rid];
              const active = actingRole === rid;
              return (
                <button
                  key={rid}
                  onClick={() => onActingRole(rid)}
                  aria-pressed={active}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                    active
                      ? "border-transparent text-white shadow-sm"
                      : "border-white/20 text-brand-100 hover:bg-white/10"
                  }`}
                  style={active ? { background: r.color } : undefined}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- tab bar (skipped when a role has only one screen) ---------- */}
      {tabs.length > 1 && (
      <div className="relative z-10 bg-white/80 backdrop-blur-md border-b border-white/60">
        <nav className="w-full px-4 sm:px-6 lg:px-8 py-1.5 sm:py-2 flex sm:justify-center gap-1.5 sm:gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`relative shrink-0 px-3.5 sm:px-5 py-1.5 sm:py-2 text-[13px] sm:text-sm font-bold whitespace-nowrap transition-all rounded-full ${
                    active
                      ? "bg-gradient-to-r from-brand-700 to-brand-500 text-white shadow-md shadow-brand-700/30"
                      : "text-slate-600 hover:text-brand-800 hover:bg-brand-50"
                  }`}
              >
                {t.label}
                {t.badge > 0 && (
                  <span
                    className={`ml-2 inline-flex items-center justify-center min-w-[1.2rem] h-[1.2rem] text-[11px] font-extrabold rounded-full px-1 ${
                      active ? "bg-accent-500 text-white" : "bg-accent-700 text-white"
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
