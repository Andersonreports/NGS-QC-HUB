import { useState } from "react";
import { api, setSession } from "../api";
import { Alert, Icon, Spinner } from "./ui";

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.login(username.trim(), password);
      setSession(data.access_token, data.user);
      onLoggedIn(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-brand-50 via-slate-100 to-accent-50">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-accent-600 text-white flex items-center justify-center">
            <Icon name="flask" size={22} />
          </div>
          <div>
            <div className="text-lg font-extrabold leading-tight">NGS QC Hub</div>
            <div className="text-xs text-slate-500 font-medium">Anderson Diagnostics</div>
          </div>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <h1 className="text-base font-bold">Sign in</h1>
            <p className="text-sm text-slate-500 mt-0.5">Use the account for your team.</p>
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          <div>
            <label className="label" htmlFor="username">Username</label>
            <input
              id="username"
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy || !username || !password}>
            {busy ? <Spinner /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
