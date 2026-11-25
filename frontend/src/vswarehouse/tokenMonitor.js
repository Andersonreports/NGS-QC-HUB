// VSWarehouse Token Monitor — the original dashboard script, mounted inside the Germline
// app. It renders into a shadow root (so its stylesheet can't leak into, or be affected by,
// the Germline UI) and talks only to /api/vswarehouse/*, where the organization comes from
// the signed-in session — never from the page — so CMC and NGS data cannot mix.
import { authHeaders, clearSession } from '../api';

async function vfetch(path, opts = {}) {
  const res = await fetch(`/api/vswarehouse${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    clearSession();
    window.location.reload();
  }
  // The Germline API reports errors as { detail }; the dashboard reads { error }.
  const json = res.json.bind(res);
  res.json = async () => {
    const body = await json();
    if (body && !body.error && body.detail) {
      body.error = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    }
    return body;
  };
  return res;
}

/** Mounts the dashboard into `root` (a ShadowRoot); `host` carries data-mode. Returns a destroy fn. */
export function mountTokenMonitor(root, host, { onBack } = {}) {
const $ = (id) => root.getElementById(id);
let refreshTimer = null;
$('home-link').addEventListener('click', () => onBack && onBack());

const CAT_ORDER = [
  { key: 'GENOME', label: 'Genome', varName: '--series-1' },
  { key: 'EXOME', label: 'Exome', varName: '--series-2' },
  { key: 'PANEL', label: 'Panel', varName: '--series-3' },
  { key: 'SUPPORTING', label: 'Supporting', varName: '--series-4' },
];

// Classify a sheet row by its Panel text for row colouring. Mirrors how the
// meter categorises samples: blank panel = a supporting (Father/Mother/Normal)
// row, genome/exome by name, everything else is a named panel ("other").
function sheetRowCategory(panel) {
  const p = (panel || '').toLowerCase();
  if (p.includes('genome')) return 'genome';
  if (p.includes('exome')) return 'exome';
  if (p.includes('support') || p === '') return 'supporting';
  return 'other';
}

const fmtInt = (n) => (n == null || n === '' ? '—' : n.toLocaleString ? n.toLocaleString('en-US') : n);
const fmtPct = (n) => (n == null ? '—' : `${n}%`);

function fmtDate(iso, opts) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(
    'en-US',
    opts || { year: 'numeric', month: 'short', day: 'numeric' }
  );
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function cssVar(name) {
  return getComputedStyle(host).getPropertyValue(name).trim();
}

let moduleMeta = null;
let activeSource = 'csv';
let currentOrgData = null;
let selectedMonth = 'all';

async function loadModuleMeta() {
  const res = await vfetch('/module');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function fetchCsvOrg() {
  const res = await vfetch('/csv');
  const body = await res.json();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function fetchExcelOrg() {
  const res = await vfetch('/sheet');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function renderMonthOptions(sorted) {
  const select = $('month-filter');
  const keys = [...new Set(sorted.map((r) => monthKey(r.reportDate)))].sort().reverse();
  select.innerHTML =
    '<option value="all">All time</option>' +
    keys.map((k) => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  selectedMonth = keys.includes(selectedMonth) ? selectedMonth : 'all';
  select.value = selectedMonth;
}

function renderHistoryViews() {
  if (!currentOrgData) return;
  const sorted = currentOrgData.reports;
  const filtered =
    selectedMonth === 'all' ? sorted : sorted.filter((r) => monthKey(r.reportDate) === selectedMonth);
  renderTrend(filtered);

  if (activeSource === 'excel') {
    const rows = currentOrgData.rawRows || [];
    const filteredRows =
      selectedMonth === 'all' ? rows : rows.filter((r) => monthKey(r.sortDate) === selectedMonth);
    renderReportsTableSheet(filteredRows);
    renderUserTrend(filteredRows);
  } else {
    renderReportsTableCsv(filtered);
  }
}

$('month-filter').addEventListener('change', (e) => {
  selectedMonth = e.target.value;
  renderHistoryViews();
});

function renderHeader(latest, source) {
  const orgNameEl = $('org-name');
  orgNameEl.textContent =
    source === 'excel' ? 'Live from Google Sheet' : latest.orgName || moduleMeta.label;
}

function renderDelta(elId, delta, { goodDirection } = {}) {
  const el = $(elId);
  if (delta == null || delta === 0) {
    el.textContent = delta === 0 ? 'No change since last entry' : '';
    el.className = 'stat-delta flat';
    return;
  }
  const arrow = delta > 0 ? '▲' : '▼';
  const sign = delta > 0 ? '+' : '';
  const isGood = goodDirection === (delta > 0 ? 'up' : 'down');
  el.textContent = `${arrow} ${sign}${fmtInt(delta)} since last entry`;
  el.className = `stat-delta ${isGood ? 'down' : 'up'}`;
}

function renderStats(latest, prev) {
  $('stat-available').textContent = fmtInt(latest.tokensAvailable);
  $('stat-available-sub').textContent = `as of ${fmtDate(latest.reportDate)}`;
  $('stat-consumed').textContent = fmtInt(latest.tokensConsumed);
  $('stat-total').textContent = fmtInt(latest.tokensTotal);
  $('stat-usage').textContent = fmtPct(latest.usagePercent);
  $('stat-usage-sub').textContent = `${fmtInt(latest.tokensConsumed)} / ${fmtInt(
    latest.tokensTotal
  )} tokens`;

  if (prev) {
    renderDelta('stat-consumed-delta', latest.tokensConsumed - prev.tokensConsumed, {
      goodDirection: 'down',
    });
  } else {
    $('stat-consumed-delta').textContent = '';
  }

  const meterFill = $('usage-meter-fill');
  const pct = Math.max(0, Math.min(100, latest.usagePercent || 0));
  const len = meterFill.getTotalLength();
  meterFill.style.strokeDasharray = `${len}`;
  meterFill.style.strokeDashoffset = `${len * (1 - pct / 100)}`;
  meterFill.classList.toggle('warn', pct >= 80);
}

function renderLicenseStat(license) {
  const daysEl = $('stat-days-remaining');
  const expiryEl = $('stat-license-expiry');
  if (!license) {
    daysEl.textContent = '—';
    expiryEl.textContent = '—';
    return;
  }
  const daysLeft = Math.round((new Date(license.expiryDate) - Date.now()) / 86400000);
  daysEl.textContent = `~${Math.max(0, daysLeft).toLocaleString('en-US')}`;
  expiryEl.textContent = fmtDate(license.expiryDate);
}

// Tokens burned PER DAY, stacked by sample type. Daily tokens per category are
// derived as the day-over-day rise in each category's cumulative token count, so
// no server-side rate table is needed on the client.
function renderTrend(history) {
  const svg = $('trend-svg');
  const tooltip = $('trend-tooltip');
  const sub = $('trend-sub');
  const legend = $('trend-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  if (history.length === 0) return;

  for (const cat of CAT_ORDER) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<span class="swatch" style="background:${cssVar(cat.varName)}"></span>${cat.label}`;
    legend.appendChild(item);
  }

  // Build per-day token deltas from the FULL cumulative series (so a month-
  // filtered view still gets a correct first-day delta), keyed by report date.
  const full = (currentOrgData && currentOrgData.reports) || history;
  const dailyByDate = new Map();
  let prev = null;
  for (const r of full) {
    const d = {};
    let tot = 0;
    for (const cat of CAT_ORDER) {
      const cur = (r.categories && r.categories[cat.key] && r.categories[cat.key].tokens) || 0;
      const pv = prev && prev.categories && prev.categories[cat.key] ? prev.categories[cat.key].tokens || 0 : 0;
      const v = Math.max(0, cur - pv);
      d[cat.key] = v;
      tot += v;
    }
    d.TOTAL = tot;
    dailyByDate.set(r.reportDate, d);
    prev = r;
  }

  const rows = history.map((h) => ({ h, daily: dailyByDate.get(h.reportDate) || { TOTAL: 0 } }));
  const totalBurn = rows.reduce((s, r) => s + r.daily.TOTAL, 0);
  const peak = Math.max(0, ...rows.map((r) => r.daily.TOTAL));
  const avg = rows.length ? totalBurn / rows.length : 0;
  sub.textContent = `${fmtInt(totalBurn)} tokens over ${rows.length} day${rows.length === 1 ? '' : 's'} · avg ${Math.round(avg).toLocaleString('en-US')}/day · peak ${fmtInt(peak)}`;

  const W = 900,
    H = 220,
    padL = 38,
    padR = 16,
    padT = 16,
    padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const niceMax = Math.max(4, Math.ceil(peak / 4) * 4);
  const band = innerW / rows.length;
  const barW = Math.min(60, band * 0.62);

  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = Math.round((niceMax / steps) * s);
    const y = padT + innerH - (v / niceMax) * innerH;
    svg.appendChild(el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: y, y2: y }));
    const label = el('text', { class: 'axis-label', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = v.toLocaleString('en-US');
    svg.appendChild(label);
  }

  const maxLabels = Math.max(1, Math.floor(innerW / 54));
  const labelEvery = Math.max(1, Math.ceil(rows.length / maxLabels));

  rows.forEach((row, i) => {
    const cx = padL + band * i + band / 2;
    let yCursor = padT + innerH;

    for (const cat of CAT_ORDER) {
      const v = row.daily[cat.key] || 0;
      if (v <= 0) continue;
      const h = (v / niceMax) * innerH;
      yCursor -= h;
      svg.appendChild(
        el('rect', { x: cx - barW / 2, y: yCursor, width: barW, height: h, fill: cssVar(cat.varName), rx: 1.5 })
      );
    }

    // Hover hit area spanning the whole day band.
    const hit = el('rect', { x: padL + band * i, y: padT, width: band, height: innerH, fill: 'transparent', style: 'cursor:pointer' });
    hit.addEventListener('mouseenter', () => {
      const wrapRect = svg.parentElement.getBoundingClientRect();
      const scaleX = wrapRect.width / W;
      const rowsHtml = CAT_ORDER.filter((c) => (row.daily[c.key] || 0) > 0)
        .map((c) => `<div class="t-row">${c.label}: ${fmtInt(row.daily[c.key])}</div>`)
        .join('');
      tooltip.innerHTML = `<div class="t-title">${fmtDate(row.h.reportDate)}</div>
        <div class="t-row"><strong>${fmtInt(row.daily.TOTAL)} tokens</strong></div>${rowsHtml}`;
      tooltip.style.left = `${cx * scaleX + 12}px`;
      tooltip.style.top = `12px`;
      tooltip.style.opacity = '1';
    });
    hit.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
    });
    svg.appendChild(hit);

    if (i % labelEvery === 0 || i === rows.length - 1) {
      const label = el('text', {
        class: 'axis-label',
        x: cx,
        y: H - 6,
        'text-anchor': i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle',
      });
      label.textContent = fmtDate(row.h.reportDate, { month: 'short', day: 'numeric' });
      svg.appendChild(label);
    }
  });
}

const USER_TREND_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--seq-300', '--seq-600'];

function renderUserTrend(rawRows) {
  const svg = $('user-trend-svg');
  const tooltip = $('user-trend-tooltip');
  const sub = $('user-trend-sub');
  const legend = $('user-trend-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  const byUser = new Map();
  for (const r of rawRows) {
    const user = (r.username || '').trim();
    if (!user) continue;
    if (!byUser.has(user)) byUser.set(user, []);
    byUser.get(user).push(r);
  }

  const usernames = [...byUser.keys()].sort();
  if (usernames.length === 0) {
    sub.textContent = 'No usage logged yet.';
    return;
  }

  const series = usernames.map((user, i) => {
    const rows = [...byUser.get(user)].sort((a, b) => new Date(a.sortDate) - new Date(b.sortDate));
    let cumulative = 0;
    const points = rows.map((r) => {
      cumulative += Number(r.tokensConsumed) || 0;
      return { x: new Date(r.sortDate).getTime(), y: cumulative, row: r };
    });
    return { user, color: USER_TREND_COLORS[i % USER_TREND_COLORS.length], points };
  });

  const totalTokens = series.reduce((s, ser) => s + (ser.points[ser.points.length - 1]?.y || 0), 0);
  sub.textContent = `${usernames.length} user${usernames.length === 1 ? '' : 's'} · ${fmtInt(totalTokens)} tokens total`;

  for (const ser of series) {
    const item = document.createElement('div');
    item.className = 'item';
    const last = ser.points[ser.points.length - 1];
    item.innerHTML = `<span class="swatch" style="background:${cssVar(ser.color)}"></span>${ser.user} (${fmtInt(
      last.y
    )})`;
    legend.appendChild(item);
  }

  const allPoints = series.flatMap((s) => s.points);
  const W = 900,
    H = 220,
    padL = 46,
    padR = 16,
    padT = 16,
    padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxVal = Math.max(1, ...allPoints.map((p) => p.y));
  const minT = Math.min(...allPoints.map((p) => p.x));
  const maxT = Math.max(...allPoints.map((p) => p.x));
  const spanT = maxT - minT || 1;

  const xFor = (t) => (allPoints.length <= 1 ? padL + innerW / 2 : padL + ((t - minT) / spanT) * innerW);
  const yFor = (v) => padT + innerH - (v / maxVal) * innerH;

  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = (maxVal / steps) * s;
    const y = yFor(v);
    svg.appendChild(el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: y, y2: y }));
    const label = el('text', { class: 'axis-label', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = Math.round(v).toLocaleString('en-US');
    svg.appendChild(label);
  }

  const dateLabels = [...new Set(allPoints.map((p) => p.x))].sort((a, b) => a - b);
  const labelEvery = Math.max(1, Math.ceil(dateLabels.length / 6));
  dateLabels.forEach((t, i) => {
    if (i % labelEvery !== 0 && i !== dateLabels.length - 1) return;
    const x = xFor(t);
    const label = el('text', {
      class: 'axis-label',
      x,
      y: H - 6,
      'text-anchor': i === 0 ? 'start' : i === dateLabels.length - 1 ? 'end' : 'middle',
    });
    label.textContent = fmtDate(new Date(t).toISOString(), { month: 'short', day: 'numeric' });
    svg.appendChild(label);
  });

  for (const ser of series) {
    const color = cssVar(ser.color);
    const pts = ser.points.map((p) => ({ ...p, sx: xFor(p.x), sy: yFor(p.y) }));

    if (pts.length > 1) {
      const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx},${p.sy}`).join(' ');
      svg.appendChild(el('path', { d: linePath, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }

    pts.forEach((p) => {
      const dot = el('circle', { cx: p.sx, cy: p.sy, r: 4, fill: cssVar('--surface'), stroke: color, 'stroke-width': 2.5 });
      svg.appendChild(dot);

      const hit = el('circle', { cx: p.sx, cy: p.sy, r: 12, fill: 'transparent', style: 'cursor:pointer' });
      hit.addEventListener('mouseenter', () => {
        dot.setAttribute('r', 6);
        const wrapRect = svg.parentElement.getBoundingClientRect();
        const scaleX = wrapRect.width / W;
        const scaleY = wrapRect.height / H;
        tooltip.innerHTML = `<div class="t-title">${ser.user}</div>
          <div class="t-row">${fmtDate(p.row.sortDate)}: ${fmtInt(Number(p.row.tokensConsumed) || 0)} tokens</div>
          <div class="t-row">Cumulative: ${fmtInt(p.y)}</div>`;
        tooltip.style.left = `${p.sx * scaleX + 12}px`;
        tooltip.style.top = `${p.sy * scaleY - 8}px`;
        tooltip.style.opacity = '1';
      });
      hit.addEventListener('mouseleave', () => {
        dot.setAttribute('r', 4);
        tooltip.style.opacity = '0';
      });
      svg.appendChild(hit);
    });
  }
}

function renderCategories(latest) {
  const legend = $('cat-legend');
  const bars = $('cat-bars');
  const miniStats = $('mini-stats');
  const sub = $('category-sub');
  legend.innerHTML = '';
  bars.innerHTML = '';
  miniStats.innerHTML = '';
  sub.textContent = `${fmtDate(latest.reportDate)} · ${fmtInt(
    latest.categories?.['TOTAL SAMPLES']?.count
  )} samples · ${fmtInt(latest.tokensConsumed)} tokens`;

  for (const cat of CAT_ORDER) {
    const data = latest.categories?.[cat.key] || { count: 0, tokens: 0 };
    const cell = document.createElement('div');
    cell.className = 'mini-stat';
    cell.innerHTML = `
      <div class="ms-label">${cat.label}</div>
      <div class="ms-count">${fmtInt(data.count)}</div>
      <div class="ms-tokens">${fmtInt(data.tokens)} tokens</div>
    `;
    miniStats.appendChild(cell);
  }
  const totalData = latest.categories?.['TOTAL SAMPLES'] || { count: 0, tokens: 0 };
  const totalCell = document.createElement('div');
  totalCell.className = 'mini-stat divider total';
  totalCell.innerHTML = `
    <div class="ms-label">Total Samples</div>
    <div class="ms-count">${fmtInt(totalData.count)}</div>
    <div class="ms-tokens">${fmtInt(totalData.tokens)} tokens</div>
  `;
  miniStats.appendChild(totalCell);

  const maxTokens = Math.max(1, ...CAT_ORDER.map((c) => latest.categories?.[c.key]?.tokens || 0));

  for (const cat of CAT_ORDER) {
    const color = cssVar(cat.varName);
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<span class="swatch" style="background:${color}"></span>${cat.label}`;
    legend.appendChild(item);

    const data = latest.categories?.[cat.key] || { count: 0, tokens: 0 };
    const pct = (data.tokens / maxTokens) * 100;

    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label">${cat.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-value">${fmtInt(data.tokens)} tok · ${fmtInt(data.count)} smp</div>
    `;
    bars.appendChild(row);
  }
}

function computeSamplesByDay(samples) {
  const byDay = new Map();
  for (const s of samples) {
    const day = (s.date || '').split(' ')[0];
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, { GENOME: 0, EXOME: 0, PANEL: 0, SUPPORTING: 0 });
    const key = (s.size || '').toUpperCase();
    const bucket = byDay.get(day);
    if (key in bucket) bucket[key]++;
  }
  return [...byDay.entries()].sort((a, b) => new Date(a[0]) - new Date(b[0]));
}

function renderSamplesByDay(latest) {
  const svg = $('day-svg');
  const tooltip = $('day-tooltip');
  const sub = $('day-sub');
  const legend = $('day-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  for (const cat of CAT_ORDER) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<span class="swatch" style="background:${cssVar(cat.varName)}"></span>${cat.label}`;
    legend.appendChild(item);
  }

  const data = computeSamplesByDay(latest.samples || []);
  if (data.length === 0) {
    sub.textContent = 'No samples logged yet.';
    return;
  }
  const totalSamples = (latest.samples || []).length;
  sub.textContent = `${fmtDate(latest.reportDate)} · ${fmtInt(totalSamples)} samples across ${
    data.length
  } day${data.length === 1 ? '' : 's'}`;

  const W = 900,
    H = 220,
    padL = 30,
    padR = 16,
    padT = 16,
    padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const totals = data.map(([, counts]) => CAT_ORDER.reduce((s, cat) => s + counts[cat.key], 0));
  const maxCount = Math.max(1, ...totals);
  const niceMax = Math.ceil(maxCount / 4) * 4 || 4;

  const band = innerW / data.length;
  const barW = Math.min(70, band * 0.5);

  // Thin the date labels so they don't overlap when there are many days;
  // every bar still renders, only some get a label (plus always the last).
  const maxLabels = Math.max(1, Math.floor(innerW / 46));
  const labelEvery = Math.max(1, Math.ceil(data.length / maxLabels));

  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = Math.round((niceMax / steps) * s);
    const y = padT + innerH - (v / niceMax) * innerH;
    svg.appendChild(el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: y, y2: y }));
    const label = el('text', { class: 'axis-label', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = v;
    svg.appendChild(label);
  }

  data.forEach(([day, counts], i) => {
    const cx = padL + band * i + band / 2;
    let yCursor = padT + innerH;
    const total = totals[i];

    CAT_ORDER.forEach((cat) => {
      const c = counts[cat.key];
      if (!c) return;
      const segH = (c / niceMax) * innerH;
      const y = yCursor - segH;
      svg.appendChild(
        el('rect', {
          class: 'day-bar-seg',
          x: cx - barW / 2,
          y,
          width: barW,
          height: segH,
          fill: cssVar(cat.varName),
        })
      );
      yCursor = y;
    });

    const isLast = i === data.length - 1;
    if (i % labelEvery === 0 || isLast) {
      const label = el('text', {
        class: 'axis-label',
        x: cx,
        y: H - 6,
        'text-anchor': i === 0 ? 'start' : isLast ? 'end' : 'middle',
      });
      label.textContent = fmtDate(`${day}T00:00:00`, { month: 'short', day: 'numeric' });
      svg.appendChild(label);
    }

    const hit = el('rect', {
      x: padL + band * i,
      y: padT,
      width: band,
      height: innerH,
      fill: 'transparent',
      style: 'cursor:pointer',
    });
    hit.addEventListener('mouseenter', () => {
      const wrapRect = svg.parentElement.getBoundingClientRect();
      const scaleX = wrapRect.width / W;
      const scaleY = wrapRect.height / H;
      const rows = CAT_ORDER.filter((cat) => counts[cat.key])
        .map((cat) => `<div class="t-row">${cat.label}: ${counts[cat.key]}</div>`)
        .join('');
      tooltip.innerHTML = `<div class="t-title">${fmtDate(`${day}T00:00:00`)}</div>${rows}<div class="t-row">Total: ${total}</div>`;
      tooltip.style.left = `${cx * scaleX + 12}px`;
      tooltip.style.top = `${padT * scaleY}px`;
      tooltip.style.opacity = '1';
    });
    hit.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
    });
    svg.appendChild(hit);
  });
}

function renderSamples(latest) {
  const tbody = root.querySelector('#samples-table tbody');
  tbody.innerHTML = '';
  const samples = [...(latest.samples || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (samples.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">No samples logged yet.</td></tr>';
    return;
  }
  for (const s of samples) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.date}</td><td class="mono">${s.hash}</td><td>${fmtInt(
      s.variantCount
    )}</td><td>${s.size}</td>`;
    tbody.appendChild(tr);
  }
}

function setReportsTableHead(mode, tokensTotal) {
  const thead = $('reports-table-head');
  if (mode === 'excel') {
    thead.innerHTML = `<tr>
      <th>Date</th><th>Time</th><th>Server</th><th>Workspace</th><th>Panel</th>
      <th>Total sample scheduled</th><th>Total sample count</th><th>Total token consumed</th>
      <th>Username</th><th>Uploaded by</th>
      <th>Pending tokens (${fmtInt(tokensTotal)})</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr><th>Date</th><th>Genome</th><th>Exome</th><th>Panel</th><th>Supporting</th><th>Samples</th><th>Consumed</th><th>Available</th></tr>`;
  }
}

// One row per day from the usage CSV: the day's per-size sample counts plus the
// running (cumulative) tokens consumed and available up to that day.
function renderReportsTableCsv(history) {
  const tbody = root.querySelector('#reports-table tbody');
  tbody.innerHTML = '';
  const rows = [...history].sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate));
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-muted)">No CSV uploaded yet.</td></tr>';
    return;
  }
  for (const r of rows) {
    const d = r.dailyCounts || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtDate(r.reportDate)}</td><td>${fmtInt(d.GENOME || 0)}</td><td>${fmtInt(
      d.EXOME || 0
    )}</td><td>${fmtInt(d.PANEL || 0)}</td><td>${fmtInt(d.SUPPORTING || 0)}</td><td>${fmtInt(
      d.TOTAL || 0
    )}</td><td>${fmtInt(r.tokensConsumed)}</td><td>${fmtInt(r.tokensAvailable)}</td>`;
    tbody.appendChild(tr);
  }
}

function renderReportsTableSheet(rawRows) {
  const tbody = root.querySelector('#reports-table tbody');
  tbody.innerHTML = '';
  const rows = [...rawRows].sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="11" style="color:var(--text-muted)">No entries logged yet.</td></tr>';
    return;
  }
  const cell = (v) => (v == null || v === '' ? '—' : v);
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.className = `cat-${sheetRowCategory(r.panel)}`;
    tr.innerHTML = `<td>${cell(r.date)}</td><td>${cell(r.time)}</td><td>${cell(
      r.server
    )}</td><td>${cell(r.workspace)}</td><td>${cell(r.panel)}</td><td>${cell(
      r.sampleScheduled
    )}</td><td>${cell(r.sampleCount)}</td><td>${cell(r.tokensConsumed)}</td><td>${cell(
      r.username
    )}</td><td>${cell(r.uploadedBy)}</td><td>${cell(r.pending)}</td>`;
    tbody.appendChild(tr);
  }
}

function showEmptyDashboard(message) {
  ['stat-total', 'stat-consumed', 'stat-available', 'stat-usage'].forEach(
    (id) => ($(id).textContent = '—')
  );
  $('stat-consumed-delta').textContent = '';
  $('stat-available-sub').textContent = '';
  $('stat-usage-sub').textContent = '';
  $('trend-svg').innerHTML = '';
  $('trend-sub').textContent = message;
  $('trend-legend').innerHTML = '';
  $('user-trend-svg').innerHTML = '';
  $('user-trend-sub').textContent = message;
  $('user-trend-legend').innerHTML = '';
  renderLicenseStat(null);
  $('mini-stats').innerHTML = '';
  $('cat-legend').innerHTML = '';
  $('cat-bars').innerHTML = '';
  $('category-sub').textContent = '';
  $('day-svg').innerHTML = '';
  $('day-legend').innerHTML = '';
  $('day-sub').textContent = '';
  root.querySelector('#samples-table tbody').innerHTML = `<tr><td colspan="4" style="color:var(--text-muted)">${message}</td></tr>`;
  const colspan = activeSource === 'excel' ? 11 : 8;
  // (excel sheet-log now has 11 columns)
  root.querySelector('#reports-table tbody').innerHTML = `<tr><td colspan="${colspan}" style="color:var(--text-muted)">${message}</td></tr>`;
  $('month-filter').innerHTML = '<option value="all">All time</option>';
}

function renderOrg(org, source) {
  currentOrgData = org;
  setReportsTableHead(source, org.reports[org.reports.length - 1]?.tokensTotal);

  // The sample-hash table only makes sense for sheet/legacy data; the CSV meter
  // is count-based, so its per-size counts live in the reports ledger instead.
  $('section-samples').hidden = source === 'csv';

  const sorted = org.reports;
  if (sorted.length === 0) {
    $('org-name').textContent =
      source === 'excel' ? 'Live from Google Sheet' : moduleMeta.label;
    showEmptyDashboard(
      source === 'excel'
        ? 'No entries logged in the sheet yet.'
        : 'No usage CSV uploaded for this module yet.'
    );
    return;
  }

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;

  renderHeader(latest, source);
  renderStats(latest, prev);
  renderLicenseStat(org.license);
  renderCategories(latest);
  renderSamplesByDay(latest);
  renderSamples(latest);

  renderMonthOptions(sorted);
  renderHistoryViews();
}

// Explains why the sheet log and the licence meter disagree. Only meaningful
// on the Excel tab, where both sources are in play.
function renderReconciliation(org, source) {
  const panel = $('reconcile-panel');
  const rec = source === 'excel' ? org && org.reconciliation : null;
  const warnings = source === 'excel' && org ? org.dateWarnings || [] : [];

  if (!rec && warnings.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const clean = !rec || rec.reconciled;
  panel.classList.toggle('is-clean', clean && warnings.length === 0);

  const badge = $('reconcile-badge');
  const scope = $('reconcile-scope');
  if (!rec) {
    badge.textContent = 'Sheet notes';
    scope.textContent = '';
  } else {
    badge.textContent = rec.reconciled
      ? 'Reconciled with license meter'
      : 'Unaccounted against license meter';
    scope.textContent = `${rec.window.start} to ${rec.window.end} · meter ${fmtInt(
      rec.meter.total.tokens
    )} tokens / ${fmtInt(rec.meter.total.count)} samples · sheet ${fmtInt(
      rec.sheet.total.tokens
    )} / ${fmtInt(rec.sheet.total.count)}`;
  }

  const list = $('reconcile-list');
  list.innerHTML = '';
  const add = (text, why) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (why) {
      const span = document.createElement('span');
      span.className = 'why';
      span.textContent = why;
      li.appendChild(span);
    }
    list.appendChild(li);
  };

  if (rec && rec.reconciled) {
    add('Every sample the meter billed is present in the sheet log.');
  }
  for (const f of (rec && rec.findings) || []) add(f.text, f.hint);
  for (const w of warnings) add(w);
}

function showFetchError(message, kind = 'error') {
  const bar = $('fetch-error');
  if (!message) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.textContent = message;
  bar.classList.toggle('warn', kind === 'warn');
}

async function refresh() {
  try {
    if (activeSource === 'excel') {
      const org = await fetchExcelOrg();
      showFetchError(org.headerIssue || null, 'warn');
      renderOrg(org, 'excel');
      renderReconciliation(org, 'excel');
    } else {
      const org = await fetchCsvOrg();
      showFetchError(null);
      const hasCsv = !!(org && org.reports && org.reports.length);
      // Keep the manage button available whenever there's data, an open modal,
      // or an undoable delete, so a mis-click that emptied the module can still
      // be reversed.
      const canManage = hasCsv || hasUndo || !uploadsModal.hidden;
      $('manage-btn').hidden = !canManage;
      renderOrg(
        org || { label: moduleMeta.label, license: null, reports: [] },
        'csv'
      );
      renderReconciliation(org, 'csv');
    }
  } catch (err) {
    showFetchError(`Couldn't load data: ${err.message}`);
  }
}

function setActiveSource(source) {
  activeSource = source;
  host.dataset.mode = source;
  $('tab-csv').classList.toggle('active', source === 'csv');
  $('tab-excel').classList.toggle('active', source === 'excel');
  $('csv-actions').hidden = source !== 'csv';
  $('excel-actions').hidden = source !== 'excel';
  $('upload-status').hidden = true;
  $('reconcile-panel').hidden = true;
  showFetchError(null);
  selectedMonth = 'all';
  refresh();
}

$('tab-csv').addEventListener('click', () => setActiveSource('csv'));
$('tab-excel').addEventListener('click', () => setActiveSource('excel'));

$('refresh-btn').addEventListener('click', async () => {
  const btn = $('refresh-btn');
  const label = btn.querySelector('span');
  btn.disabled = true;
  label.textContent = 'Refreshing…';
  try {
    await refresh();
  } finally {
    btn.disabled = false;
    label.textContent = 'Refresh';
  }
});

$('download-btn').addEventListener('click', async () => {
  const btn = $('download-btn');
  btn.disabled = true;
  try {
    const res = await vfetch('/report');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = match ? match[1] : 'token-report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    showUploadStatus('error', `Couldn't download the report: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---- Manage uploads modal ---------------------------------------------------

const uploadsModal = $('uploads-modal');
let hasUndo = false;

function closeUploadsModal() {
  uploadsModal.hidden = true;
}

function uploadRangeText(u) {
  if (!u.dayCount) return 'no dated rows';
  const days = `${u.dayCount} day${u.dayCount === 1 ? '' : 's'}`;
  if (u.firstDate && u.lastDate) {
    const span =
      u.firstDate === u.lastDate
        ? fmtDate(`${u.firstDate}T00:00:00`)
        : `${fmtDate(`${u.firstDate}T00:00:00`)} → ${fmtDate(`${u.lastDate}T00:00:00`)}`;
    return `${days} · ${span}`;
  }
  return days;
}

function renderUndo(trash) {
  const btn = $('uploads-undo');
  const label = $('uploads-undo-label');
  const last = (trash || [])[0];
  hasUndo = !!last;
  if (!last) {
    btn.hidden = true;
    return;
  }
  const n = (last.removed || []).length;
  const what =
    last.kind === 'all'
      ? `all (${n} file${n === 1 ? '' : 's'})`
      : (last.removed && last.removed[0] && last.removed[0].filename) || 'last upload';
  label.textContent = `Undo delete of ${what}`;
  btn.title = `Deleted ${fmtDateTime(last.deletedAt)}`;
  btn.hidden = false;
  btn.disabled = false;
}

function renderUploads(body) {
  const uploads = body.uploads || [];
  renderUndo(body.trash);
  const list = $('uploads-list');
  list.innerHTML = '';
  if (!uploads.length) {
    list.innerHTML = '<div class="uploads-empty">No CSV uploads stored.</div>';
    $('uploads-delete-all').disabled = true;
    return;
  }
  $('uploads-delete-all').disabled = false;
  for (const u of uploads) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    const info = document.createElement('div');
    info.className = 'upload-info';
    const name = document.createElement('div');
    name.className = 'upload-name';
    name.textContent = u.filename || 'usage.csv';
    if (u.legacy) {
      const tag = document.createElement('span');
      tag.className = 'upload-tag';
      tag.textContent = 'existing';
      name.appendChild(tag);
    }
    const meta = document.createElement('div');
    meta.className = 'upload-meta';
    meta.textContent = `${uploadRangeText(u)} · uploaded ${fmtDateTime(u.uploadedAt)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'danger icon-btn';
    del.title = 'Delete this upload';
    del.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3.5A1 1 0 017.5 2.5h1a1 1 0 011 1v1M4 4.5l.6 8A1.5 1.5 0 006.1 14h3.8a1.5 1.5 0 001.5-1.5l.6-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    del.addEventListener('click', () => deleteOneUpload(u, del));

    row.appendChild(info);
    row.appendChild(del);
    list.appendChild(row);
  }
}

async function loadUploadsList() {
  const list = $('uploads-list');
  list.innerHTML = '<div class="uploads-empty">Loading…</div>';
  try {
    const res = await vfetch('/uploads');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    renderUploads(body);
  } catch (err) {
    list.innerHTML = `<div class="uploads-empty">Couldn't load uploads: ${err.message}</div>`;
  }
}

async function deleteOneUpload(u, btn) {
  if (!confirm(`Delete this upload?\n\n${u.filename || 'usage.csv'}\n${uploadRangeText(u)}\n\nThe totals will be rebuilt from the remaining uploads.`)) {
    return;
  }
  btn.disabled = true;
  try {
    const res = await vfetch(
      `/uploads/${encodeURIComponent(u.id)}`,
      { method: 'DELETE' }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
    renderUploads(body);
    showUploadStatus('success', `Removed ${u.filename || 'upload'} — undo in Manage CSVs.`);
    await refresh();
  } catch (err) {
    btn.disabled = false;
    showUploadStatus('error', `Couldn't delete upload: ${err.message}`);
  }
}

$('manage-btn').addEventListener('click', () => {
  uploadsModal.hidden = false;
  loadUploadsList();
});

$('uploads-close').addEventListener('click', closeUploadsModal);
uploadsModal.addEventListener('click', (e) => {
  if (e.target === uploadsModal) closeUploadsModal();
});
function onKeydown(e) {
  if (e.key === 'Escape' && !uploadsModal.hidden) closeUploadsModal();
}
document.addEventListener('keydown', onKeydown);

$('uploads-delete-all').addEventListener('click', async (e) => {
  const label = moduleMeta ? moduleMeta.label : 'this module';
  if (!confirm(`Delete ALL uploaded CSVs for ${label}?\n\nThis clears every accumulated day. You'll need to re-upload to restore it.`)) {
    return;
  }
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await vfetch('/upload', { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
    renderUploads(body);
    showUploadStatus('success', 'All uploaded CSVs deleted — undo in Manage CSVs.');
    await refresh();
  } catch (err) {
    showUploadStatus('error', `Couldn't delete uploads: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

$('uploads-undo').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await vfetch('/uploads/restore', {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Restore failed (${res.status})`);
    renderUploads(body);
    const n = (body.restored || []).length;
    showUploadStatus('success', `Restored ${n} upload${n === 1 ? '' : 's'}.`);
    await refresh();
  } catch (err) {
    btn.disabled = false;
    showUploadStatus('error', `Couldn't restore: ${err.message}`);
  }
});

function showUploadStatus(kind, message) {
  const bar = $('upload-status');
  bar.className = `upload-status ${kind}`;
  bar.textContent = message;
  bar.hidden = false;
  if (kind !== 'info') {
    clearTimeout(showUploadStatus._t);
    showUploadStatus._t = setTimeout(() => {
      bar.hidden = true;
    }, 5000);
  }
}

async function uploadCsv(file) {
  if (!file) return;
  if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) {
    showUploadStatus('error', `"${file.name}" isn't a CSV file.`);
    return;
  }
  showUploadStatus('info', `Uploading ${file.name}…`);
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await vfetch('/upload', {
      method: 'POST',
      body: formData,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Upload failed (${res.status})`);
    }
    const added = body.added || 0;
    const updated = body.updated || 0;
    const unchanged = body.unchanged || 0;
    const day = (n) => `${n} day${n === 1 ? '' : 's'}`;
    if (added === 0 && updated === 0) {
      // Every incoming row already matched what's stored — a genuine no-op.
      // Flag it plainly so it doesn't read as "nothing happened / it failed".
      showUploadStatus('warn', `${file.name}: nothing changed — all ${day(unchanged)} already match what's stored.`);
    } else {
      const parts = [];
      if (added) parts.push(`${day(added)} added`);
      if (updated) parts.push(`${day(updated)} updated`);
      if (unchanged) parts.push(`${day(unchanged)} unchanged`);
      showUploadStatus('success', `${file.name} loaded — ${parts.join(', ')}.`);
    }
    if (activeSource !== 'csv') setActiveSource('csv');
    else await refresh();
  } catch (err) {
    showUploadStatus('error', `Failed to load ${file.name}: ${err.message}`);
  }
}

const uploadInput = $('upload-input');
$('upload-btn').addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', () => {
  if (uploadInput.files[0]) uploadCsv(uploadInput.files[0]);
  uploadInput.value = '';
});

const dropOverlay = $('drop-overlay');
let dragDepth = 0;
function onDragEnter(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
}
window.addEventListener('dragenter', onDragEnter);
function onDragOver(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
}
window.addEventListener('dragover', onDragOver);
function onDragLeave(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
}
window.addEventListener('dragleave', onDragLeave);
function onDrop(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const files = [...(e.dataTransfer.files || [])];
  files.forEach(uploadCsv);
}
window.addEventListener('drop', onDrop);

async function init() {
  try {
    moduleMeta = await loadModuleMeta();
  } catch (err) {
    $('module-title').textContent = 'VSWarehouse Token Monitor';
    showFetchError(err.message);
    return;
  }
  $('module-title').textContent = moduleMeta.label;
  $('open-sheet-link').href = moduleMeta.sheetUrl || '#';
  setActiveSource('csv');
  refreshTimer = setInterval(refresh, 15000);
}

init();

return function destroy() {
  clearInterval(refreshTimer);
  clearTimeout(showUploadStatus._t);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('dragenter', onDragEnter);
  window.removeEventListener('dragover', onDragOver);
  window.removeEventListener('dragleave', onDragLeave);
  window.removeEventListener('drop', onDrop);
};
}
