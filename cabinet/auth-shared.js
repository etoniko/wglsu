const DEFAULT_AVATAR = "/assets/default-avatar.png";

function apiBase() {
  const h = location.hostname;
  if (h === "wgl.su" || h === "www.wgl.su" || h.endsWith("github.io")) {
    return "https://sixz.ru";
  }
  return "";
}

function apiUrl(path) {
  if (!path) return apiBase() || "/";
  if (/^https?:\/\//i.test(path)) return path;
  return apiBase() + path;
}

function mediaUrl(u) {
  if (!u) return DEFAULT_AVATAR;
  if (/^https?:\/\//i.test(u)) return u;
  if (String(u).startsWith("/uploads/")) return apiUrl(u);
  return u;
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
}
function initTheme() {
  applyTheme(localStorage.getItem("theme") || "dark");
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem("theme", next);
}
window.toggleTheme = toggleTheme;
initTheme();

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const t = localStorage.getItem("wgl_token") || "";
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(apiUrl(path), { ...opts, headers });
  const data = await res.json().catch(() => ({ ok: false, error: "Ошибка ответа" }));
  if (!res.ok) {
    const err = new Error(data.error || "Ошибка");
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function avatarUrl(u) {
  if (!u) return DEFAULT_AVATAR;
  if (typeof u === "string") return mediaUrl(u || DEFAULT_AVATAR);
  return mediaUrl(u.avatar || DEFAULT_AVATAR);
}
