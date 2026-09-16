import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearSession, getStoredUser, getToken } from "./api";
import { isAwaiting } from "./workflow";
import AdminUsers from "./components/AdminUsers";
import Dashboard from "./components/Dashboard";
import ApprovalStatus from "./components/ApprovalStatus";
import Login from "./components/Login";
import MonthlyReport from "./components/MonthlyReport";
import PendingRuns from "./components/PendingRuns";
import UploadWorkspace from "./components/UploadWorkspace";
import RunHistory from "./components/RunHistory";
import Toasts from "./components/Toasts";
import TopBar from "./components/TopBar";
import TransferForm from "./components/TransferForm";
import { Alert } from "./components/ui";

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
  const [tab, setTab] = useState(() => defaultTabFor());
  const [viewingRun, setViewingRun] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const seenNotifications = useRef(null);

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...toast }]);
    if (toast.kind !== "error") {
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

      // Float a toast for anything that arrived since the last poll.
      const unreadIds = notifData.filter((n) => !n.read).map((n) => n.id);
      if (seenNotifications.current === null) {
        seenNotifications.current = new Set(unreadIds);
      } else {
        notifData
          .filter((n) => !n.read && !seenNotifications.current.has(n.id))
          .forEach((n) => {
            seenNotifications.current.add(n.id);
            const run = runsData.find((r) => r.id === n.run_id);
            pushToast({ title: "New update", text: n.text, runNumber: run?.run_number });
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

  // The header's height changes with the tab bar, so publish it for the sticky
  // preview panes instead of hard-coding an offset they'd drift out of sync with.
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
  // No separate "all runs" tab: My work already ends with the counts and the full run list.
  const tabs = [
    { id: "work", label: "My work", badge: pendingCount },
    { id: "uploads", label: user.role === "primary_team" ? "Uploads & preview" : "Files & preview" },
    { id: "monthly", label: "Monthly Report" },
    ...(user.role === "admin" ? [{ id: "admin", label: "Accounts" }] : []),
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
        ) : tab === "uploads" ? (
          <UploadWorkspace
            user={user}
            onViewRun={setViewingRun}
            onChanged={() => afterChange("Uploaded — the run moved to the next step.")}
          />
        ) : tab === "monthly" ? (
          <MonthlyReport user={user} onViewRun={setViewingRun} />
        ) : (
          <AdminUsers />
        )}
      </main>

      <Toasts toasts={toasts} onDismiss={dismissToast} onOpen={setViewingRun} />
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

  const overview = <WorkflowOverview {...shared} />;

  if (user.role === "admin") {
    return (
      <>
        {overview}
        <Alert kind="info">
          You are signed in as an administrator. Use the <strong>Accounts</strong> tab to manage team
          logins — the workflow steps belong to the team accounts.
        </Alert>
      </>
    );
  }

  return overview;
}

/** The shared work/status layout used by every workflow role. `leftExtra` is
 * role-specific content (Wet Lab's "start a new transfer" form) that goes above
 * the pending-runs list in the left column, so that column isn't left empty just
 * because nothing happens to be awaiting that role right now. */
function WorkflowOverview({ user, runs, onViewRun, onChanged, leftExtra }) {
  // Three columns side by side on desktop, each scrolling internally within a fixed
  // height (matching the header) so the page itself never grows as runs pile up.
  // On narrower screens they stack instead, each falling back to its own capped height.
  return (
    <div className="grid grid-cols-1 gap-4 items-stretch lg:grid-cols-[minmax(16rem,1.1fr)_minmax(0,2fr)_minmax(16rem,1.1fr)] lg:h-[calc(100vh-var(--header-h,7.5rem)-3rem)]">
      <div className={`min-w-0 lg:h-full ${leftExtra ? "space-y-4 lg:overflow-y-auto" : "lg:overflow-hidden"}`}>
        {leftExtra}
        <PendingRuns runs={runs} user={user} onChanged={onChanged} onViewRun={onViewRun} title="Action Required" />
      </div>
      <div className="min-w-0 lg:h-full lg:overflow-hidden">
        <Dashboard user={user} runs={runs} onViewRun={onViewRun} />
      </div>
      <div className="min-w-0 lg:h-full lg:overflow-hidden">
        <ApprovalStatus runs={runs} onViewRun={onViewRun} />
      </div>
    </div>
  );
}
