import { useState } from "react";
import { api } from "../api";
import { Alert, Icon, Spinner } from "./ui";

/** Step 1–2: Wet Lab records that a run's raw data has been transferred to the common drive. */
export default function TransferForm({ onCreated }) {
  const [runNumber, setRunNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const run = await api.createRun(runNumber.trim());
      setCreated(run.run_number);
      setRunNumber("");
      onCreated?.(run);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 border-l-4 border-l-wetlab">
      <header className="mb-4">
        <h2 className="text-base font-bold">Raw data transfer</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Enter the run number once the raw FASTQ / CSV / Excel / Md5sum files are in the common drive.
          This marks the run <span className="font-semibold">Transferred</span> and notifies the Primary Team.
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
            Run <span className="font-mono font-bold">{created}</span> marked as Transferred. Primary Team
            has been notified.
          </Alert>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2.5">
        <div className="flex-1">
          <label className="label" htmlFor="new-run">Run number</label>
          <input
            id="new-run"
            className="field font-mono"
            placeholder="e.g. RUN-045"
            value={runNumber}
            onChange={(e) => setRunNumber(e.target.value)}
            required
          />
        </div>
        <div className="sm:self-end">
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy || !runNumber.trim()}>
            {busy ? <Spinner /> : <Icon name="check" size={15} strokeWidth={2.4} />}
            {busy ? "Saving…" : "Mark as Transferred"}
          </button>
        </div>
      </form>
    </section>
  );
}
