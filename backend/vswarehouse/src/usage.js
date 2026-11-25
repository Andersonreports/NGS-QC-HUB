// Golden Helix "Usage by Size" CSV is the token meter (replaces the old PDF).
//
// Shape: one row per calendar day, columns are per-size *sample counts*:
//
//   Category,"Genome Samples (...) (5)","Exome Samples (...) (700)",...
//   2026-09-07,0,1,0,0
//   2026-09-09,0,4,0,0
//
// The first column holds the date (its header is literally "Category"); the
// remaining columns are counts for Genome / Exome / Panel / Supporting, and
// each column header carries that size's all-time total in parentheses.
//
// The CSV has no token column, so tokens are derived from counts using Golden
// Helix's per-size rate. These rates come straight from the clean meter data
// (Exome 270 samples -> 810 tokens = 3; Panel 1:1; Genome 2 -> 12 = 6).
// Supporting samples bill at 1; re-analysing a sample within 30 days is free,
// so a derived total can run a few tokens above the meter — close enough for a
// usage dashboard, and the rates are overridable per module.

const fs = require('fs');
const path = require('path');
const { loadOrgLicenses, licenseInfo } = require('./store');

const DATA_DIR = process.env.VSW_DATA_DIR || path.join(__dirname, '..', 'data');
const CATS = ['GENOME', 'EXOME', 'PANEL', 'SUPPORTING'];
const SIZE_LABEL = { GENOME: 'Genome', EXOME: 'Exome', PANEL: 'Panel', SUPPORTING: 'Supporting' };
const DEFAULT_RATES = { GENOME: 6, EXOME: 3, PANEL: 1, SUPPORTING: 1 };

function csvPath(moduleId) {
  return path.join(DATA_DIR, `${moduleId}-usage.csv`);
}

// Manifest of individual uploads for a module. Each upload keeps its own parsed
// day rows so a single upload can be removed later and the merged store rebuilt
// from whatever remains. `<moduleId>-usage.csv` is the DERIVED merge of all
// uploads (what buildOrg reads); the manifest is the source of truth.
function uploadsPath(moduleId) {
  return path.join(DATA_DIR, `${moduleId}-uploads.json`);
}

function hasModuleCsv(moduleId) {
  return fs.existsSync(csvPath(moduleId));
}

function saveModuleCsv(moduleId, buffer) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(csvPath(moduleId), buffer);
}

function newUploadId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Load the ordered list of uploads for a module. If there's no manifest yet but
// a legacy merged CSV exists (uploaded before per-upload tracking), adopt it as
// a single "legacy" upload so it still shows up and can be deleted.
function loadUploads(moduleId) {
  const mp = uploadsPath(moduleId);
  if (fs.existsSync(mp)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mp, 'utf8'));
      if (Array.isArray(parsed.uploads)) return parsed.uploads;
    } catch {
      /* fall through to legacy/empty */
    }
  }
  if (hasModuleCsv(moduleId)) {
    const days = loadStoredDays(moduleId);
    if (days.length) {
      let uploadedAt = new Date().toISOString();
      try {
        uploadedAt = fs.statSync(csvPath(moduleId)).mtime.toISOString();
      } catch {
        /* keep now */
      }
      return [{ id: 'legacy', filename: `${moduleId}-usage.csv`, uploadedAt, legacy: true, days }];
    }
  }
  return [];
}

// Merge every upload's day rows in upload order (later uploads overwrite earlier
// ones for a shared date — "latest upload wins").
function mergeUploads(uploads) {
  let merged = [];
  for (const u of uploads) {
    merged = mergeDays(merged, u.days || []).merged;
  }
  return merged;
}

// Persist the manifest and regenerate the derived merged CSV. With no uploads
// left, remove both files so the module reads as empty.
function saveUploads(moduleId, uploads) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const mp = uploadsPath(moduleId);
  const cp = csvPath(moduleId);
  if (!uploads.length) {
    if (fs.existsSync(mp)) fs.unlinkSync(mp);
    if (fs.existsSync(cp)) fs.unlinkSync(cp);
    return;
  }
  fs.writeFileSync(mp, JSON.stringify({ uploads }, null, 2) + '\n');
  fs.writeFileSync(cp, serializeDays(mergeUploads(uploads)));
}

function uploadDateRange(days) {
  if (!days || !days.length) return { firstDate: null, lastDate: null };
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { firstDate: sorted[0].date, lastDate: sorted[sorted.length - 1].date };
}

// Metadata for each upload (no day rows), newest first, for the manage-uploads UI.
function listUploads(moduleId) {
  return loadUploads(moduleId)
    .map((u) => {
      const { firstDate, lastDate } = uploadDateRange(u.days);
      return {
        id: u.id,
        filename: u.filename,
        uploadedAt: u.uploadedAt,
        legacy: !!u.legacy,
        dayCount: (u.days || []).length,
        firstDate,
        lastDate,
      };
    })
    .reverse();
}

// ---- Recoverable deletes (trash) -------------------------------------------
// Every delete snapshots the removed upload(s) here so a mis-click can be undone.
// Bounded to the most recent MAX_TRASH snapshots per module.
const MAX_TRASH = 20;

function trashPath(moduleId) {
  return path.join(DATA_DIR, 'trash', `${moduleId}.json`);
}

function loadTrash(moduleId) {
  const tp = trashPath(moduleId);
  if (!fs.existsSync(tp)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(tp, 'utf8'));
    return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

function writeTrash(moduleId, snapshots) {
  const tp = trashPath(moduleId);
  if (!snapshots.length) {
    if (fs.existsSync(tp)) fs.unlinkSync(tp);
    return;
  }
  fs.mkdirSync(path.dirname(tp), { recursive: true });
  fs.writeFileSync(tp, JSON.stringify({ snapshots }, null, 2) + '\n');
}

function uploadSummary(u) {
  const { firstDate, lastDate } = uploadDateRange(u.days);
  return {
    id: u.id,
    filename: u.filename,
    uploadedAt: u.uploadedAt,
    legacy: !!u.legacy,
    dayCount: (u.days || []).length,
    firstDate,
    lastDate,
  };
}

// Record a delete: `removedFull` are the full upload objects (with day rows) so
// they can be re-added on restore; `kind` is 'one' or 'all'.
function pushTrash(moduleId, removedFull, kind) {
  const snapshots = loadTrash(moduleId);
  snapshots.push({
    id: newUploadId(),
    deletedAt: new Date().toISOString(),
    kind,
    removed: removedFull.map(uploadSummary),
    removedFull,
  });
  while (snapshots.length > MAX_TRASH) snapshots.shift();
  writeTrash(moduleId, snapshots);
}

// Summary of recoverable deletes for a module, newest first.
function listTrash(moduleId) {
  return loadTrash(moduleId)
    .map((s) => ({ id: s.id, deletedAt: s.deletedAt, kind: s.kind, removed: s.removed || [] }))
    .reverse();
}

// Restore the most recent delete: re-add any removed uploads that aren't present
// now (uploads made since the delete are kept), re-ordered by upload time so the
// latest-wins merge is unchanged. Returns the restored summaries, or null when
// the trash is empty.
function restoreLastTrash(moduleId) {
  const snapshots = loadTrash(moduleId);
  if (!snapshots.length) return null;
  const snap = snapshots.pop();
  const current = loadUploads(moduleId);
  const curIds = new Set(current.map((u) => u.id));
  const toAdd = (snap.removedFull || []).filter((u) => !curIds.has(u.id));
  const next = [...current, ...toAdd].sort((a, b) =>
    (a.uploadedAt || '') < (b.uploadedAt || '') ? -1 : (a.uploadedAt || '') > (b.uploadedAt || '') ? 1 : 0
  );
  saveUploads(moduleId, next);
  writeTrash(moduleId, snapshots);
  return { restored: toAdd.map(uploadSummary), kind: snap.kind };
}

// Delete one upload by id and rebuild the merged store. Returns true if removed.
function deleteUpload(moduleId, uploadId) {
  const uploads = loadUploads(moduleId);
  const removed = uploads.find((u) => u.id === uploadId);
  if (!removed) return false;
  pushTrash(moduleId, [removed], 'one');
  saveUploads(moduleId, uploads.filter((u) => u.id !== uploadId));
  return true;
}

// Delete every upload for a module (clear all), keeping a restorable snapshot.
function deleteModuleCsv(moduleId) {
  const uploads = loadUploads(moduleId);
  if (!uploads.length) return false;
  pushTrash(moduleId, uploads, 'all');
  saveUploads(moduleId, []);
  return true;
}

// Canonical header we re-serialise the merged store with. The parser matches
// columns by keyword, so these plain names round-trip cleanly.
const CANON_HEADER = 'Date,Genome,Exome,Panel,Supporting';

function serializeDays(days) {
  const lines = [CANON_HEADER];
  for (const d of days) {
    lines.push(
      [d.date, d.counts.GENOME || 0, d.counts.EXOME || 0, d.counts.PANEL || 0, d.counts.SUPPORTING || 0].join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function loadStoredDays(moduleId) {
  if (!hasModuleCsv(moduleId)) return [];
  try {
    return parseUsageCsv(fs.readFileSync(csvPath(moduleId), 'utf8')).days;
  } catch {
    return [];
  }
}

function sameCounts(a, b) {
  return CATS.every((k) => (a.counts[k] || 0) === (b.counts[k] || 0));
}

// Merge incoming day rows into what's already stored, keyed by date (upsert).
// A new date is added; a date already present has its counts OVERWRITTEN with
// the incoming values (the latest export wins, so a corrected day takes
// effect); an incoming row identical to what's stored is left unchanged. We
// replace rather than add, so re-uploading an overlapping CSV still never
// double-counts a day.
function mergeDays(existing, incoming) {
  const byDate = new Map(existing.map((d) => [d.date, d]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const d of incoming) {
    const prev = byDate.get(d.date);
    if (!prev) {
      added++;
    } else if (sameCounts(prev, d)) {
      unchanged++;
      continue;
    } else {
      updated++;
    }
    byDate.set(d.date, d);
  }
  const merged = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  return { merged, added, updated, unchanged };
}

/**
 * Ingest an uploaded CSV for a module: parse it, record it as its own upload in
 * the manifest, and rebuild the derived merged store. New dates are added,
 * dates already present are overwritten by this (latest) upload, and identical
 * rows are left as-is. The upload is retained so it can be deleted later.
 * @returns {{added:number, updated:number, unchanged:number, incomingDays:number, totalDays:number, uploadId:string}}
 */
function ingestCsv(moduleId, text, filename) {
  const { days } = parseUsageCsv(text); // throws on a non-usage CSV
  if (days.length === 0) {
    return { added: 0, updated: 0, unchanged: 0, incomingDays: 0, totalDays: loadStoredDays(moduleId).length };
  }
  const uploads = loadUploads(moduleId);
  // How this upload changes the current merged store (same semantics as before).
  const before = mergeUploads(uploads);
  const { added, updated, unchanged } = mergeDays(before, days);

  const entry = {
    id: newUploadId(),
    filename: filename || `${moduleId}-usage.csv`,
    uploadedAt: new Date().toISOString(),
    days,
  };
  uploads.push(entry);
  saveUploads(moduleId, uploads);

  return {
    added,
    updated,
    unchanged,
    incomingDays: days.length,
    totalDays: mergeUploads(uploads).length,
    uploadId: entry.id,
  };
}

// Minimal RFC-4180-ish parser: handles quoted fields and \r\n, drops blank rows.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Map a column header to a category by keyword, so the exact header text
// ("Exome Samples (5K-1.5M variants) (700)") doesn't have to be hard-coded.
function categoryForHeader(header) {
  const h = String(header || '').toLowerCase();
  if (h.includes('genome')) return 'GENOME';
  if (h.includes('exome')) return 'EXOME';
  if (h.includes('panel')) return 'PANEL';
  if (h.includes('support')) return 'SUPPORTING';
  return null;
}

/**
 * Parse the usage-by-size CSV text into an ordered list of day rows.
 * @returns {{ days: Array<{date:string, counts:Object}>, firstDate:string|null, lastDate:string|null }}
 */
function parseUsageCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { days: [], firstDate: null, lastDate: null };

  const header = rows[0];
  const colCat = header.map(categoryForHeader);
  if (!colCat.some((k) => k)) {
    throw new Error('CSV has no Genome/Exome/Panel/Supporting columns — is this a "usage by size" export?');
  }

  const days = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = (r[0] || '').trim();
    // Skip any non-date row (stray totals line, blank, etc.).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const counts = { GENOME: 0, EXOME: 0, PANEL: 0, SUPPORTING: 0 };
    for (let c = 1; c < r.length; c++) {
      const key = colCat[c];
      if (!key) continue;
      const n = parseInt(String(r[c] || '').replace(/,/g, ''), 10);
      if (Number.isFinite(n)) counts[key] += n;
    }
    days.push({ date, counts });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    days,
    firstDate: days.length ? days[0].date : null,
    lastDate: days.length ? days[days.length - 1].date : null,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Build an org object (same shape the dashboard already consumes) from a
 * module's stored CSV. `org.reports` is a per-day cumulative series: each day
 * is a snapshot of tokens consumed so far, so the trend, burn rate and stats
 * all work off daily data. The latest snapshot also carries every synthesised
 * sample and the full-period category totals used for reconciliation.
 *
 * @param {string} moduleId
 * @param {object} mod  { label, orgName, licenseKey, tokensTotal, rates? }
 * @returns {object|null} null when the module has no CSV yet
 */
function buildOrg(moduleId, mod) {
  if (!hasModuleCsv(moduleId)) return null;
  const text = fs.readFileSync(csvPath(moduleId), 'utf8');
  const { days, firstDate, lastDate } = parseUsageCsv(text);
  const rates = { ...DEFAULT_RATES, ...(mod.rates || {}) };
  const licenses = loadOrgLicenses();

  const cum = {
    GENOME: { count: 0, tokens: 0 },
    EXOME: { count: 0, tokens: 0 },
    PANEL: { count: 0, tokens: 0 },
    SUPPORTING: { count: 0, tokens: 0 },
  };
  const allSamples = [];
  const reports = [];

  for (const day of days) {
    for (const key of CATS) {
      const c = day.counts[key] || 0;
      cum[key].count += c;
      cum[key].tokens += c * rates[key];
      for (let i = 0; i < c; i++) {
        allSamples.push({ date: `${day.date} 00:00:00`, hash: '', variantCount: null, size: SIZE_LABEL[key] });
      }
    }

    const categories = {};
    let totalCount = 0;
    let totalTokens = 0;
    for (const key of CATS) {
      categories[key] = { count: cum[key].count, tokens: cum[key].tokens };
      totalCount += cum[key].count;
      totalTokens += cum[key].tokens;
    }
    categories['TOTAL SAMPLES'] = { count: totalCount, tokens: totalTokens };

    const tokensTotal = mod.tokensTotal;
    const tokensConsumed = totalTokens;
    const tokensAvailable = tokensTotal != null ? tokensTotal - tokensConsumed : null;

    reports.push({
      filename: `${moduleId}-usage.csv`,
      reportDate: new Date(`${day.date}T00:00:00Z`).toISOString(),
      orgName: mod.orgName,
      licenseKey: mod.licenseKey,
      withinTier: tokensTotal != null ? tokensConsumed <= tokensTotal : true,
      tokensConsumed,
      tokensTotal: tokensTotal != null ? tokensTotal : null,
      tokensAvailable,
      usagePercent: tokensTotal ? round1((tokensConsumed / tokensTotal) * 100) : null,
      categories,
      // Only the latest snapshot needs the full sample list (breakdown views).
      samples: [],
      dailyCounts: { ...day.counts, TOTAL: CATS.reduce((s, k) => s + (day.counts[k] || 0), 0) },
      // Full-period window so reconciliation covers the whole CSV, not a
      // rolling 30 days like the old PDF meter did.
      windowStart: firstDate,
      windowEnd: day.date,
      windowDays: null,
    });
  }

  if (reports.length) {
    reports[reports.length - 1].samples = allSamples;
  }

  return {
    licenseKey: mod.licenseKey,
    label: mod.label,
    reports,
    license: licenseInfo(mod.licenseKey, licenses),
  };
}

module.exports = {
  parseUsageCsv,
  buildOrg,
  hasModuleCsv,
  saveModuleCsv,
  deleteModuleCsv,
  listUploads,
  deleteUpload,
  listTrash,
  restoreLastTrash,
  ingestCsv,
  mergeDays,
  csvPath,
  DEFAULT_RATES,
};
