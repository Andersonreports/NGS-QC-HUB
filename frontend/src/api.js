const TOKEN_KEY = "ngsqc_token";
const USER_KEY = "ngsqc_user";

// Same-origin in production (FastAPI serves the built frontend); Vite dev proxies /api.
const BASE = "";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, { method = "GET", json, form, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body });

  if (res.status === 401 && auth) {
    clearSession();
    window.location.reload();
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg).join(", ");
    } catch {
      /* keep default message */
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", json: { username, password }, auth: false }),
  me: () => request("/api/auth/me"),
  changePassword: (old_password, new_password) =>
    request("/api/auth/password", { method: "PATCH", json: { old_password, new_password } }),

  listRuns: () => request("/api/runs"),
  getRun: (runNumber) => request(`/api/runs/${encodeURIComponent(runNumber)}`),
  createRun: (run_number) => request("/api/runs", { method: "POST", json: { run_number } }),
  deleteRun: (runNumber) => request(`/api/runs/${encodeURIComponent(runNumber)}`, { method: "DELETE" }),
  advanceRun: (runNumber, { note, action, files } = {}) => {
    const form = new FormData();
    if (note) form.append("note", note);
    if (action) form.append("action", action);
    (files || []).forEach((f) => form.append("files", f));
    return request(`/api/runs/${encodeURIComponent(runNumber)}/advance`, { method: "POST", form });
  },
  attachmentUrl: (runNumber, attachmentId) =>
    `${BASE}/api/runs/${encodeURIComponent(runNumber)}/files/${attachmentId}`,
  deleteFile: (runNumber, attachmentId) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/files/${attachmentId}`, { method: "DELETE" }),

  listFiles: (runNumber) =>
    request(`/api/runs/files/all${runNumber ? `?run_number=${encodeURIComponent(runNumber)}` : ""}`),

  listNotifications: () => request("/api/notifications"),
  markAllRead: () => request("/api/notifications/read-all", { method: "POST" }),
  markRead: (id) => request(`/api/notifications/${id}/read`, { method: "POST" }),

  getSheet: (runNumber) => request(`/api/runs/${encodeURIComponent(runNumber)}/sheet`),
  editSheetCell: (runNumber, payload) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/sheet/cell`, { method: "PATCH", json: payload }),
  editSheetQC: (runNumber, payload) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/sheet/qc`, { method: "PATCH", json: payload }),
  addSheetAnnotation: (runNumber, payload) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/sheet/annotations`, { method: "POST", json: payload }),
  deleteSheetAnnotation: (runNumber, annotationId) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/sheet/annotations/${encodeURIComponent(annotationId)}`, { method: "DELETE" }),
  reingestSheet: (runNumber, sheetName) =>
    request(`/api/runs/${encodeURIComponent(runNumber)}/sheet/reingest`, { method: "POST", json: { sheet_name: sheetName } }),
  sheetExportUrl: (runNumber) => `${BASE}/api/runs/${encodeURIComponent(runNumber)}/sheet/export.xlsx`,

  getMonthlyReport: (year, month) => request(`/api/reports/monthly?year=${year}&month=${month}`),
  editMonthlyReportCell: (runNumber, field, value) =>
    request(`/api/reports/monthly/${encodeURIComponent(runNumber)}/cell`, { method: "PATCH", json: { field, value } }),
  monthlyReportExportUrl: (year, month) => `${BASE}/api/reports/monthly/export.xlsx?year=${year}&month=${month}`,

  listUsers: () => request("/api/admin/users"),
  createUser: (payload) => request("/api/admin/users", { method: "POST", json: payload }),
  deactivateUser: (id) => request(`/api/admin/users/${id}/deactivate`, { method: "POST" }),
  activateUser: (id) => request(`/api/admin/users/${id}/activate`, { method: "POST" }),
};

/** Fetch an attachment's bytes (auth header included) for inline previewing. */
export async function fetchAttachmentBlob(runNumber, attachmentId) {
  const res = await fetch(api.attachmentUrl(runNumber, attachmentId), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Could not load that file for preview.");
  return res.blob();
}

/** Download the current edited state of the consolidated Excel as a fresh .xlsx. */
export async function downloadSheetExport(runNumber) {
  const res = await fetch(api.sheetExportUrl(runNumber), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Could not export the sheet.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${runNumber}_Consolidated.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the month's consolidated table as a fresh .xlsx. */
export async function downloadMonthlyReport(year, month) {
  const res = await fetch(api.monthlyReportExportUrl(year, month), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Could not export that month's report.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const monthName = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  a.download = `Consolidated_${monthName.replace(" ", "_")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download an attachment through fetch so the Authorization header is sent. */
export async function downloadAttachment(runNumber, attachmentId, filename) {
  const res = await fetch(api.attachmentUrl(runNumber, attachmentId), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Could not download that file.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
