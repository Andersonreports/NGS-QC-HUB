import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearSession, getStoredUser, getToken } from "./api";
import { isAwaiting } from "./workflow";
import AdminUsers from "./components/AdminUsers";
import Dashboard from "./components/Dashboard";
import ApprovalStatus from "./components/ApprovalStatus";
import Login from "./components/Login";
import MonthlyReport from "./components/MonthlyReport";
import PendingRuns from "./components/PendingRuns";
import RunHistory from "./components/RunHistory";
import Toasts from "./components/Toasts";
import TopBar from "./components/TopBar";
import TransferForm from "./components/TransferForm";
import UnreadDigest from "./components/UnreadDigest";
import { Alert } from "./components/ui";
import { playChime } from "./sound";

const POLL_MS = 10000;

/** Every user starts from the shared work queue after signing in. */
function defaultTabFor() {
  return "work";
}

export default function App() {
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [runs, setRuns] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [unreadDigest, setUnreadDigest] = useState([]);
  const [tab, setTab] = useState(() => defaultTabFor());
  const [viewingRun, setViewingRun] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const seenNotifications = useRef(null);

  // Most toasts (a "Saved" confirmation after your own action) auto-dismiss —
  // they're just acknowledging something you already know happened. A `sticky`
  // toast (someone else's update arriving — a new transfer, an approval) stays
  // until you dismiss it yourself, since those are easy to miss if you're not
  // looking at the screen the moment they appear.
  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...toast }]);
    if (toast.kind !== "error" && !toast.sticky) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
    }
  }, []);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [runsData, notifData] = await Promise.all([api.listRuns(), api.listNotifications()]);
      setRuns(runsData);
      setNotifications(notifData);
      setLoadError(null);

      // On the very first load of a fresh page/tab, whatever's already unread
      // goes into one centered digest — impossible to miss, and not a pile of
      // separate corner banners. Anything that arrives afterward, while this
      // session is already open and being watched, still gets its own corner
      // toast — that's a live update, not a summary of what was missed. A QC
      // fail is the one exception: it always gets the centered floating
      // banner, live or not, since it's important enough that a small corner
      // toast isn't enough.
      const isFirstLoad = seenNotifications.current === null;
      if (isFirstLoad) seenNotifications.current = new Set();
      const arrived = notifData.filter((n) => !n.read && !seenNotifications.current.has(n.id));
      if (arrived.length > 0) playChime();
      arrived.forEach((n) => seenNotifications.current.add(n.id));

      const withRunNumber = (n) => ({ ...n, runNumber: runsData.find((r) => r.id === n.run_id)?.run_number });
      const qcFails = arrived.filter((n) => n.kind === "qc_fail");
      const rest = arrived.filter((n) => n.kind !== "qc_fail");

      if (qcFails.length > 0) {
        setUnreadDigest((current) => [...current, ...qcFails.map(withRunNumber)]);
      }

      if (isFirstLoad) {
        if (rest.length > 0) {
          setUnreadDigest((current) => [...current, ...rest.map(withRunNumber)]);
        }
      } else {
        rest.forEach((n) => {
          const run = runsData.find((r) => r.id === n.run_id);
          pushToast({ kind: "notification", sticky: true, title: "New update", text: n.text, runNumber: run?.run_number });
        });
      }
    } catch (err) {
      setLoadError(err.message);
    }
  }, [user, pushToast]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [user, refresh]);

  function logout() {
    clearSession();
    seenNotifications.current = null;
    setUser(null);
    setRuns([]);
    setNotifications([]);
    setToasts([]);
  }

  // Publish the page header's height for the sticky preview panes below, instead
  // of hard-coding an offset they'd drift out of sync with.
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const apply = () =>
      document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, [user, tab]);

  const afterChange = useCallback(
    (message) => {
      setRefreshKey((k) => k + 1);
      if (message) pushToast({ kind: "success", title: "Saved", text: message });
    },
    [pushToast]
  );

  if (!user) {
    return (
      <Login
        onLoggedIn={(u) => {
          seenNotifications.current = null;
          setUser(u);
          setTab(defaultTabFor());
        }}
      />
    );
  }

  const pendingCount = runs.filter((r) => isAwaiting(r, user.role)).length;
  // "Uploads & preview" was dropped — My work's own search already finds a run and
  // opens the same files/preview/status view, so a second screen for that was just
  // a duplicate. There's no separate admin account — Primary Team Head manages
  // team logins directly.
  const tabs = [
    { id: "work", label: "My work", badge: pendingCount, icon: "clock" },
    { id: "monthly", label: "Monthly Report", icon: "file" },
    ...(user.role === "primary_head" ? [{ id: "admin", label: "User Management", icon: "users" }] : []),
  ];
  return (
    <div className="min-h-screen">
      <TopBar
        user={user}
        tabs={tabs}
        activeTab={tab}
        onTab={(id) => {
          setTab(id);
          setViewingRun(null);
        }}
        notifications={notifications}
        onMarkAllRead={async () => {
          await api.markAllRead();
          refresh();
        }}
        onOpenRun={async (n) => {
          await api.markRead(n.id).catch(() => {});
          const run = runs.find((r) => r.id === n.run_id);
          if (run) setViewingRun(run.run_number);
          refresh();
        }}
        onLogout={logout}
      />

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {loadError && <Alert kind="error">{loadError}</Alert>}

        {viewingRun ? (
          <RunHistory
            runNumber={viewingRun}
            user={user}
            refreshKey={refreshKey}
            onBack={() => setViewingRun(null)}
            onChanged={() => afterChange("The run has moved to the next step.")}
            onSilentChange={() => afterChange()}
          />
        ) : tab === "work" ? (
          <WorkView
            user={user}
            runs={runs}
            onViewRun={setViewingRun}
            onChanged={afterChange}
            pushToast={pushToast}
          />
        ) : tab === "monthly" ? (
          <MonthlyReport user={user} onViewRun={setViewingRun} />
        ) : (
          <AdminUsers />
        )}
      </main>

      <Toasts toasts={toasts} onDismiss={dismissToast} onOpen={setViewingRun} />
      <UnreadDigest
        items={unreadDigest}
        onDismiss={() => setUnreadDigest([])}
        onOpen={(n) => {
          setViewingRun(n.runNumber);
          setUnreadDigest([]);
        }}
      />
    </div>
  );
}

/**
 * Each role's own steps first, then the shared run counts and run list so the page
 * always has the state of every run on it.
 */
function WorkView({ user, runs, onViewRun, onChanged, pushToast }) {
  const changed = () => onChanged("The run has moved to the next step.");
  const shared = { runs, user, onViewRun, onChanged: changed };

  // Every role's "My work" is the same shape — the overview (Action Required +
  // counts + run list) and nothing else — except Wet Lab, who also starts new runs.
  // That form lives at the top of the left column itself (not bolted on below), so
  // the column isn't left empty on the common case of nothing awaiting Wet Lab.
  if (user.role === "wetlab") {
    return (
      <WorkflowOverview
        {...shared}
        leftExtra={
          <TransferForm
            onCreated={(run) => {
              onChanged();
              pushToast({
                kind: "success",
                title: "Transfer recorded",
                text: `Run ${run.run_number} marked as Transferred. Primary Team notified.`,
              });
            }}
          />
        }
      />
    );
  }

  return <WorkflowOverview {...shared} />;
}

/** The shared work/status layout used by every workflow role. `leftExtra` is
 * role-specific content (Wet Lab's "start a new transfer" form) that goes above
 * the pending-runs list in the left column. When neither that nor any pending run
 * exists — nothing currently awaits this role — the left column is dropped
 * entirely rather than reserved as dead space; Dashboard and Approval status
 * split the width instead. */
function WorkflowOverview({ user, runs, onViewRun, onChanged, leftExtra }) {
  const hasLeftContent = Boolean(leftExtra) || runs.some((r) => isAwaiting(r, user.role));

  // Three columns side by side on desktop, each scrolling internally within a fixed
  // height (matching the header) so the page itself never grows as runs pile up.
  // On narrower screens they stack instead, each falling back to its own capped height.
  return (
    <div
      className={`grid grid-cols-1 gap-4 items-stretch lg:h-[calc(100vh-var(--header-h,7.5rem)-3rem)] ${
        hasLeftContent
          ? "lg:grid-cols-[minmax(16rem,1.1fr)_minmax(0,2fr)_minmax(16rem,1.1fr)]"
          : "lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1.1fr)]"
      }`}
    >
      {hasLeftContent && (
        <div className={`min-w-0 lg:h-full ${leftExtra ? "space-y-4 lg:overflow-y-auto" : "lg:overflow-hidden"}`}>
          {leftExtra}
          <PendingRuns runs={runs} user={user} onChanged={onChanged} onViewRun={onViewRun} title="Action Required" />
        </div>
      )}
      <div className="min-w-0 lg:h-full lg:overflow-hidden">
        <Dashboard user={user} runs={runs} onViewRun={onViewRun} />
      </div>
      <div className="min-w-0 lg:h-full lg:overflow-hidden">
        <ApprovalStatus runs={runs} onViewRun={onViewRun} />
      </div>
    </div>
  );
}
