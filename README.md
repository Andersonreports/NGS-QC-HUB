# Germline Exome QC Hub

Internal workflow app for the Wet Lab ↔ Bioinformatics handoff: Wet Lab records a raw data
transfer by run number, the Primary Team uploads the CSV/Excel, and both the consolidated Excel
and the consolidated PDF are each approved by **either** team head (Primary Head or Bioinfo Head —
one approval is enough). Wet Lab can review either document, but the run never waits on them.

## Running it on the LAN

```bash
./start.sh
```

Then open, from any machine on the network:

```
http://<this-machine's-LAN-IP>:8000
```

`start.sh` prints the exact URL when it starts. To use a different port: `PORT=9000 ./start.sh`.

If other machines can't reach it, the firewall on this machine is likely blocking the port:

```bash
sudo ufw allow 8000/tcp
```

## Logins

Change these passwords after the first sign-in (or replace the accounts from the
**User Management** tab while acting as the Primary Team Head).

| Username          | Password            | Role                                             |
| ----------------- | ------------------- | ------------------------------------------------ |
| `wetlab`          | `wetlab@123`        | Wet Lab — records transfers, reviews documents   |
| `sethu`           | `sethu@123`         | Primary Team — uploads CSV/Excel/PDF             |
| `tamilarasu`      | `tamilarasu@123`    | Primary Team Head — approves the Excel/PDF       |
| `dr.muthukumaran` | `muthukumaran@123`  | Bioinfo Team Head — approves the Excel/PDF       |
| `admin`           | `admin@123`         | Admin — can act as any of the four roles above   |

The **admin** account is a testing/administration login: after signing in it shows a
role switcher ("Admin · testing as …") in the header, and every screen, tab and action
behaves as the selected role — so one login can walk a run through the whole pipeline
without logging out and back in. Each team member should still get their own role login
for day-to-day use; a role decides which steps they're allowed to act on.

## The workflow

The app never shows step numbers — teams see plain instructions ("Upload raw CSV & Excel",
"Approve the consolidated Excel"). The numbers below are only a reference back to the flow
diagram; steps 5 and 9 there ("prepares consolidated Excel/PDF") are work done outside the
dashboard, so preparing and uploading are a single action here.

| Who                  | What they do in the app                                        | Diagram |
| -------------------- | -------------------------------------------------------------- | ------- |
| Wet Lab              | Enter run number → **Mark as transferred**                     | 1–2     |
| —                    | Primary Team notified (floating alert + bell)                  | 3       |
| Primary Team         | **Upload raw CSV & Excel**                                     | 4       |
| Primary Team         | **Upload consolidated Excel** → sends it for approval          | 5–6     |
| Primary **or** Bioinfo Head | Approve the consolidated Excel, or send it back — **either head is enough** | 7 |
| Wet Lab              | *Optionally* review the Excel (non-blocking)                   | 7       |
| Primary Team         | **Upload consolidated PDF**                                    | 8–9     |
| Primary **or** Bioinfo Head | Approve the consolidated PDF, or send it back — **either head is enough** | 10 |
| Wet Lab              | *Optionally* review the PDF (non-blocking)                     | 10      |
| Primary Team         | **Approval status & notes** — who approved what, when          | 11      |

Each document — the consolidated Excel and the consolidated PDF — is gated by a single
approval step owned by **both** team heads: whichever of the Primary Team Head or the Bioinfo
Team Head acts first decides it (approve → proceed, request changes → send back). The other
head's approval is **not** required. Wet Lab is no longer a gate on either document; while a
document is awaiting head approval, Wet Lab may record an optional **"Reviewed"** note, but the
run never waits for them.

The last step reads **"Samples approved — moved to Tertiary team for analysis"**: once a head's
PDF approval is in, every approval is complete and the samples are considered handed off to the
Tertiary team for their own analysis. That's a status, not an account in this app yet — there's
no Tertiary login or action here, just the label and the notification telling the Primary Team
it happened.

A head requesting changes sends the run back with a note (optional only for the Primary Team
Head on the Excel, since they flag errors directly in the sheet) — Excel approvals return it to
the consolidated Excel upload, PDF approvals to the PDF upload. Every action — approvals, Wet
Lab reviews, send-backs — is kept in the run's history with who did it, when, and the files
attached.

### Tracking send-backs

A run that a reviewer sent back is labelled **Sent back — needs re-upload** until the team
uploads a replacement, then **Re-uploaded — back in review**. The dashboard counts them, the
run list shows who sent it back and why, and each run folder keeps both versions of the file
(`consolidated.xlsx`, `consolidated_v2.xlsx`, …) rather than overwriting.

### Uploads & preview (one screen, split)

The **Uploads & preview** tab is a single full-width screen: uploads on the left, a live
preview of whatever file is selected on the right.

- Type a run number → **Load run** and the three uploads appear as an ordered checklist.
- Picking a file to upload previews it immediately, *before* it's sent — so you can check
  you grabbed the right sheet.
- Clicking any file already uploaded previews it too.
- With no run loaded, the left pane lists every uploaded file across all runs (searchable by
  run number or file name), so this one screen doubles as the file browser.

Preview handles **Excel** (`.xlsx`/`.xls`, with a tab per sheet), **CSV/TSV**, **PDF** (embedded
viewer) and images. Anything else offers a download instead. The spreadsheet parser is loaded
only when you actually preview a sheet, so it costs nothing the rest of the time.

### Uploads are hierarchical

A later upload stays locked until the earlier one is done, and each lock says why:

1. **Raw CSV & Excel** — always available on a transferred run.
2. **Consolidated Excel** — locked until the raw CSV *and* Excel are uploaded.
3. **Consolidated PDF** — locked until the consolidated Excel has been approved by **either**
   team head. The lock clears as soon as one head (Primary or Bioinfo) signs off the Excel.

This is enforced server-side too, not just in the UI — the API rejects an upload aimed at a
step the run isn't on, so the order can't be bypassed.

### The consolidated Excel is a live, shared spreadsheet — not just a file

Once Primary Team uploads the consolidated Excel, the preview pane stops being a static
read-only view and becomes an editable, collaborative grid, backed by structured data in
the database (not just the uploaded file):

- **Primary Team** can edit any cell's value directly in the grid, and leave a **note** on
  a cell, a whole row, or a whole column.
- **Primary Team Head** can flag a cell, row, or column as an **error**, and sets two
  columns appended to every consolidated Excel: **QC Pass** (Yes / Fail, defaults to Yes)
  and **Re-Sequencing** (No / Yes, defaults to No) — one decision per sample row.
- Everyone who can see this step sees the same live data, and a running **"All notes &
  flags"** list at the bottom of the grid — so Primary Team sees exactly what Primary Team
  Head flagged, with no separate report to go look for.
- A row or cell with an open flag is tinted red in the grid; a note-only row is tinted
  amber. Clicking any cell, row header, or column header opens a small panel to view or
  add to that exact target.
- **Export .xlsx** in the grid's toolbar generates a fresh Excel file reflecting the
  current edited data plus the QC Pass / Re-Sequencing columns, on demand — the original
  uploaded file is kept untouched on disk for provenance.
- If Primary Team re-uploads after a send-back, cell *values* refresh from the new file,
  but every note, flag, and QC decision survives (they're keyed by row position, not by
  the file itself) — so a reviewer's flag doesn't disappear just because the team pushed a
  fix.

This only applies to the **consolidated Excel** step — the raw CSV/Excel backup and the
PDF still preview read-only (CSV/Excel as a plain table, PDF in the browser's own viewer).

### Viewing runs and files

Every run is visible to every role, but only the steps that role is actually involved in —
the workflow restricts *acting* on a step everywhere, and now also restricts *seeing* the
steps that are another team's internal mechanics.

Specifically, "Primary Team notified" and the raw CSV/Excel backup upload are Primary Team's
own internal steps before the consolidated Excel exists — Wet Lab and the two team heads never
had a role in them, so they're hidden for those roles: no timeline entry, no file, and the run's
current position reads as "With Primary Team" rather than naming the internal step. The Primary
Team itself always sees the full pipeline. This is enforced in one place
(`frontend/src/workflow.js`'s `HIDDEN_STAGES`) rather than scattered per-screen.

- **My work** ends with the run counts (clickable filters) and every run as a list, showing
  which team it's with, its status, and how many files it has.
- **A run's page** — a *Files for this run* panel with the newest file this viewer can see
  already open in the preview, then the history filtered the same way.

Downloads and previews go through the API with the signed-in user's token, so files aren't
publicly reachable by URL.

### What each team sees

Each role gets only the screens it needs, so nothing is duplicated across tabs.

- **Wet Lab** — a single screen: mark a transfer, then the Primary Team's files to preview and
  *optionally review* (their review never blocks the run), then the counts and run list. No tab
  bar, because there's nothing to switch between.
- **Primary Team** — lands on **Uploads & preview** (their main job). *My work* holds anything
  waiting on them, the approval status board, and the run list.
- **Primary Team Head / Bioinfo Team Head** — land on an approval page per run: the document
  open in the preview beside it, the approvals collected so far, and approve / request-changes.
- **Administrator** — lands on **Accounts**; workflow steps belong to the team accounts.

## Theme

Orange and blue, anchored on the two colours from the original flow diagram —
`#1668c1` blue and `#c1440e` orange. Both are real Tailwind scales
(`brand-*` and `accent-*` in `tailwind.config.js`), so changing the brand later is a
two-line edit rather than a find-and-replace.

- **Blue** carries structure and actions: the header band, primary buttons, links,
  focus rings, "in progress".
- **Orange** carries brand and attention: the logo mark, the active tab, the step
  that's waiting on you, the "Awaiting you" count, "Ready to upload".
- **Green / amber / red** stay semantic — approved, sent back and re-uploaded, errors.

Role colours sit inside the same palette: the two teams take the bright tones
(Wet Lab orange, Primary Team blue) and the two heads the deep tones (Primary Team
Head navy, Bioinfo Team Head dark rust), so they're on-brand and still distinguishable.
Every text/background pair in the header clears WCAG AA (lowest measured 6.4:1).

## Where files are stored

Uploads land in one folder per run number — a plain drop folder, ready to point at your real
storage later:

```
backend/data/uploads/
  RUN-101/
    Run101_raw.csv
    Run101_raw.xlsx
    Run101_consolidated.xlsx
```

To move this onto network storage, either mount that storage at `backend/data/uploads` or change
`UPLOADS_DIR` in `backend/app/config.py`.

The database is a single SQLite file at `backend/data/ngsqc.db`. **Back up `backend/data/`** —
it holds the runs, history, accounts, and uploaded files.

## Not wired up yet

- **Email notifications.** Notifications are in-app only (floating alert + bell). To send real
  email when a run is marked Transferred, provide an SMTP host/port, from-address, and
  credentials.
- **Auto-start on boot.** Currently started by hand with `./start.sh`; can be installed as a
  systemd service so it survives reboots.
- **HTTPS.** Runs over plain HTTP, which is fine on a trusted LAN but means passwords travel
  unencrypted on the network.

## Layout

```
backend/          FastAPI + SQLite API (also serves the built frontend)
  app/workflow.py   the 13-step pipeline — the source of truth for stage order and roles
  app/routers/      auth, runs, notifications, admin endpoints
  data/             SQLite DB + uploads (not in version control)
frontend/         React + Vite + Tailwind UI
  src/workflow.js   mirrors backend/app/workflow.py — keep the two in sync
prototype/        the original clickable HTML mockup (reference only)
```

## Development

```bash
# API with reload on :8000
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload

# UI with hot reload on :5173 (proxies /api to :8000)
cd frontend && npm run dev
```

After changing the frontend, rebuild so the served app picks it up: `cd frontend && npm run build`.

## VSWarehouse Token Monitor

Choosing an organization on the landing page offers **Germline** or **VSWarehouse** (not a navbar tab); VSWarehouse Token Monitor lives at
`/cmc/vswarehouse` and `/ngs/vswarehouse`. It shows that organization's own Golden Helix token
usage (uploaded usage CSV) and live Google Sheet, and downloads its own PDF report. The
organization always comes from the signed-in session, so CMC and NGS data never mix. Everyone
signed in can view; uploading/deleting CSVs is limited to Primary Team and the team heads.

The monitor's logic is Node code in `backend/vswarehouse`, started automatically (loopback only)
by the backend — Node.js must be installed; `start.sh`/`start.bat` run `npm install` there on
first start. Configure it in `backend/.env` (never committed):

```
VSW_CMC_LICENSE_KEY=...   VSW_CMC_SHEET_ID=...
VSW_NGS_LICENSE_KEY=...   VSW_NGS_SHEET_ID=...
# optional: VSW_CMC_TOKENS_TOTAL / VSW_NGS_TOKENS_TOTAL (default 6000), VSW_PORT (default 4173)
```

Its data (uploaded CSVs per organization) lives in `backend/vswarehouse/data`.
