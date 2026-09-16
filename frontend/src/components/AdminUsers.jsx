import { useEffect, useState } from "react";
import { api } from "../api";
import { ROLES } from "../workflow";
import { Alert, Icon, RoleChip, Spinner } from "./ui";

const ASSIGNABLE_ROLES = ["wetlab", "primary_team", "primary_head", "bioinfo_head", "admin"];

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ username: "", full_name: "", role: "wetlab", password: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  async function load() {
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const user = await api.createUser({ ...form, username: form.username.trim().toLowerCase() });
      setCreated(user.username);
      setForm({ username: "", full_name: "", role: "wetlab", password: "" });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user) {
    try {
      if (user.is_active === false) await api.activateUser(user.id);
      else await api.deactivateUser(user.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <header className="mb-4">
          <h2 className="text-base font-bold">Add a team member</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Each person signs in with their own account; their role decides which steps they can act on.
          </p>
        </header>

        {error && (
          <div className="mb-4">
            <Alert kind="error" onDismiss={() => setError(null)}>{error}</Alert>
          </div>
        )}
        {created && (
          <div className="mb-4">
            <Alert kind="success" onDismiss={() => setCreated(null)}>
              Account <span className="font-mono font-bold">{created}</span> created.
            </Alert>
          </div>
        )}

        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="u-username">Username</label>
            <input
              id="u-username"
              className="field"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="u-fullname">Full name</label>
            <input
              id="u-fullname"
              className="field"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="u-role">Team / role</label>
            <select
              id="u-role"
              className="field"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="u-password">Temporary password</label>
            <input
              id="u-password"
              className="field"
              type="text"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" disabled={busy}>
              {busy ? <Spinner /> : <Icon name="plus" size={15} strokeWidth={2.4} />}
              Create account
            </button>
          </div>
        </form>
      </section>

      <section className="card overflow-hidden">
        <header className="p-5 border-b border-slate-200">
          <h2 className="text-base font-bold">Accounts</h2>
        </header>
        {!users ? (
          <div className="p-8 flex justify-center text-brand-700">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-bold">Username</th>
                  <th className="px-5 py-2.5 font-bold">Name</th>
                  <th className="px-5 py-2.5 font-bold">Role</th>
                  <th className="px-5 py-2.5 font-bold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3 font-mono font-semibold">{u.username}</td>
                    <td className="px-5 py-3">{u.full_name}</td>
                    <td className="px-5 py-3">
                      <RoleChip role={u.role} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        className="text-xs font-bold text-slate-500 hover:text-red-700"
                        onClick={() => toggleActive(u)}
                      >
                        {u.is_active === false ? "Reactivate" : "Deactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
