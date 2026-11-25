const fs = require('fs');
const express = require('express');
const multer = require('multer');

const {
  buildOrg,
  ingestCsv,
  deleteModuleCsv,
  listUploads,
  deleteUpload,
  listTrash,
  restoreLastTrash,
} = require('./src/usage');
const { streamReportPdf } = require('./src/generateReport');
const { getSheetReports } = require('./src/parseSheet');
const { reconcile } = require('./src/reconcile');

// Each module pairs one license (a Golden Helix "usage by size" CSV — the token
// meter) with one live Google Sheet (the Excel report). The CSV carries no
// license key, so the organization it's uploaded for decides which license and
// token cap it belongs to. License keys and sheet ids come from the environment
// (backend/.env) — nothing identifying is hard-coded here.
function moduleFromEnv(id, label, orgName) {
  const P = `VSW_${id.toUpperCase()}_`;
  const tokensTotal = Number(process.env[`${P}TOKENS_TOTAL`] || 6000);
  return {
    label,
    orgName,
    licenseKey: process.env[`${P}LICENSE_KEY`] || '',
    tokensTotal,
    sheetId: process.env[`${P}SHEET_ID`] || '',
    // Header row's "Pending tokens (N)" label has been getting overwritten in
    // this sheet; used only if the header itself can't tell us the total.
    sheetTokensTotalFallback: tokensTotal,
  };
}
const MODULES = {
  cmc: moduleFromEnv('cmc', 'Anderson CMC System', 'Anderson Diagnostics & Labs (Shivasanmuganatha)'),
  ngs: moduleFromEnv('ngs', 'NGS Server System', 'Anderson Diagnostics & Labs (Honguntikar)'),
};

const PORT = process.env.VSW_PORT || 4173;
const INTERNAL_TOKEN = process.env.VSW_INTERNAL_TOKEN || '';

function buildAllOrgs() {
  return Object.entries(MODULES)
    .map(([id, mod]) => buildOrg(id, mod))
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// License keys are used server-side only for grouping and must never reach the
// client.
function sanitizeOrg(org) {
  if (!org) return org;
  const { licenseKey, label, reports, license } = org;
  return {
    label,
    license,
    reports: reports.map(({ licenseKey: _lk, ...rest }) => rest),
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/csv' ||
      file.originalname.toLowerCase().endsWith('.csv');
    cb(null, ok);
  },
});

const app = express();
// Internal service: only the Germline backend (which has already authenticated the
// user and chosen their organization) may call it.
app.use((req, res, next) => {
  if (!INTERNAL_TOKEN || req.get('x-internal-token') !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
});

app.get('/api/modules', (req, res) => {
  res.json(
    Object.entries(MODULES).map(([id, m]) => ({
      id,
      label: m.label,
      sheetUrl: m.sheetId ? `https://docs.google.com/spreadsheets/d/${m.sheetId}/edit?usp=sharing` : '',
    }))
  );
});

app.get('/api/orgs', (req, res) => {
  res.json(buildAllOrgs().map(sanitizeOrg));
});

app.get('/api/orgs/:moduleId', (req, res) => {
  const mod = MODULES[req.params.moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  const org = buildOrg(req.params.moduleId, mod);
  if (!org) return res.status(404).json({ error: 'No CSV uploaded for this module yet.' });
  res.json(sanitizeOrg(org));
});

// Upload a usage CSV for one module. ?m=<moduleId> says which license it is.
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err || !req.file) {
      return res.status(400).json({ error: err?.message || 'Only CSV files are accepted.' });
    }
    const moduleId = req.query.m;
    const mod = MODULES[moduleId];
    if (!mod) return res.status(400).json({ error: 'Unknown or missing module (?m=...).' });

    const text = req.file.buffer.toString('utf8');
    let summary;
    try {
      summary = ingestCsv(moduleId, text, req.file.originalname);
    } catch (e) {
      return res.status(400).json({ error: `Could not read CSV: ${e.message}` });
    }
    if (summary.incomingDays === 0) {
      return res.status(400).json({ error: 'No dated rows found in the CSV.' });
    }

    console.log(
      `Ingested CSV for ${mod.label} (${req.file.originalname}): ` +
        `${summary.added} new day(s), ${summary.updated} updated, ${summary.unchanged} unchanged`
    );
    res.json({
      ...sanitizeOrg(buildOrg(moduleId, mod)),
      added: summary.added,
      updated: summary.updated,
      unchanged: summary.unchanged,
    });
  });
});

// List the individual CSV uploads stored for a module (newest first), plus any
// recoverable deletes.
app.get('/api/uploads/:moduleId', (req, res) => {
  const mod = MODULES[req.params.moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  res.json({ uploads: listUploads(req.params.moduleId), trash: listTrash(req.params.moduleId) });
});

// Restore the most recent delete for a module (undo).
app.post('/api/uploads/:moduleId/restore', (req, res) => {
  const { moduleId } = req.params;
  const mod = MODULES[moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  const result = restoreLastTrash(moduleId);
  if (!result) return res.status(404).json({ error: 'Nothing to restore.' });
  console.log(`Restored last delete for ${mod.label} (${result.restored.length} upload(s))`);
  res.json({ ok: true, uploads: listUploads(moduleId), trash: listTrash(moduleId), restored: result.restored });
});

// Delete one upload by id and rebuild the merged store from what remains.
app.delete('/api/uploads/:moduleId/:uploadId', (req, res) => {
  const { moduleId, uploadId } = req.params;
  const mod = MODULES[moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  const removed = deleteUpload(moduleId, uploadId);
  if (!removed) return res.status(404).json({ error: 'No such upload.' });
  console.log(`Deleted upload ${uploadId} for ${mod.label}`);
  res.json({ ok: true, uploads: listUploads(moduleId), trash: listTrash(moduleId) });
});

// Delete every uploaded CSV for a module, clearing all stored days.
app.delete('/api/upload/:moduleId', (req, res) => {
  const moduleId = req.params.moduleId;
  const mod = MODULES[moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  const removed = deleteModuleCsv(moduleId);
  if (!removed) {
    return res.status(404).json({ error: 'No CSV uploaded for this module.' });
  }
  console.log(`Deleted all uploads for ${mod.label}`);
  res.json({ ok: true, uploads: listUploads(moduleId), trash: listTrash(moduleId) });
});

app.get('/api/sheet/:moduleId', async (req, res) => {
  const mod = MODULES[req.params.moduleId];
  if (!mod) return res.status(404).json({ error: 'Unknown module.' });
  if (!mod.sheetId) return res.status(503).json({ error: 'No Google Sheet is configured for this organization.' });

  try {
    const { reports, rawRows, headerIssue, dateWarnings } = await getSheetReports(mod.sheetId, {
      orgName: mod.orgName,
      fallbackTotal: mod.sheetTokensTotalFallback,
    });
    const org = buildOrg(req.params.moduleId, mod);
    // Reconcile the log against the latest CSV snapshot, which is the license
    // meter for the full period it covers.
    const latest = org && org.reports.length ? org.reports[org.reports.length - 1] : null;
    res.json({
      label: mod.label,
      license: org?.license || null,
      reports,
      rawRows,
      headerIssue: headerIssue || null,
      dateWarnings: dateWarnings || [],
      reconciliation: latest ? reconcile(latest, rawRows) : null,
      meterSource: latest ? { filename: latest.filename, reportDate: latest.reportDate } : null,
    });
  } catch (err) {
    res.status(502).json({ error: `Failed to load live sheet: ${err.message}` });
  }
});

// PDF report for exactly one module (?m=<moduleId>) — never a cross-organization one.
app.get('/api/report', (req, res) => {
  const moduleId = req.query.m;
  const mod = MODULES[moduleId];
  if (!mod) return res.status(404).send('Unknown module.');
  const org = buildOrg(moduleId, mod);
  if (!org) return res.status(404).send('No report data available for that scope.');

  const slug = moduleId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="token-report-${slug}-${today}.pdf"`);

  streamReportPdf(res, [sanitizeOrg(org)], { scopeLabel: mod.label });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`VSWarehouse token service listening on 127.0.0.1:${PORT}`);
});
