/** Общие действия с профилем: смотреть, в друзья, ЛС, подарок */
window.WGLSocial = (function () {
  const DEFAULT_AVATAR = "/assets/default-avatar.png";

  /** На GitHub Pages (wgl.su) API живёт на https://sixz.ru */
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
    if (u.startsWith("/uploads/") || u.startsWith("/api/")) return apiUrl(u);
    return u;
  }

  function wsUrl() {
    const base = apiBase();
    if (base) {
      const u = new URL(base);
      return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/ws`;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }

  function token() {
    return localStorage.getItem("wgl_token") || "";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(apiUrl(path), { ...opts, headers });
    const data = await res.json().catch(() => ({ ok: false, error: "Ошибка" }));
    if (!res.ok) {
      const err = new Error(data.error || "Ошибка");
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function ensureModal() {
    let el = document.getElementById("wglProfileModal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "wglProfileModal";
    el.className = "wgl-modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="wgl-modal-backdrop" data-close></div>
      <div class="wgl-modal-card" role="dialog" aria-modal="true">
        <button type="button" class="wgl-modal-x" data-close aria-label="Закрыть">×</button>
        <div class="wgl-modal-body" id="wglProfileModalBody">Загрузка…</div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) close();
    });
    return el;
  }

  function close() {
    const el = document.getElementById("wglProfileModal");
    if (el) el.hidden = true;
  }

  async function openProfile(userId) {
    const modal = ensureModal();
    const body = document.getElementById("wglProfileModalBody");
    modal.hidden = false;
    body.innerHTML = `<p class="cab-hint">Загрузка…</p>`;
    try {
      const headers = {};
      if (token()) headers.Authorization = `Bearer ${token()}`;
      const res = await fetch(apiUrl(`/api/users/${userId}`), { headers });
      const data = await res.json();
      if (!res.ok || !data.user) throw new Error(data.error || "Не найден");
      const u = data.user;
      const logged = !!token();
      let actions = `
        <a class="btn btn-ghost" href="/id${u.id}">Открыть профиль</a>`;
      if (logged && !u.isSelf) {
        if (u.isFriend) {
          actions += `
            <a class="btn btn-primary" href="/cabinet/?dm=${u.id}">Написать в ЛС</a>
            <button type="button" class="btn btn-ghost" data-gift="${u.id}">Подарок</button>`;
        } else if (u.requestOut) {
          actions += `<span class="cab-hint">Заявка в друзья отправлена</span>`;
        } else if (u.requestIn) {
          actions += `<button type="button" class="btn btn-primary" data-accept="${u.id}">Принять в друзья</button>`;
        } else {
          actions += `<button type="button" class="btn btn-primary" data-add="${u.id}">В друзья</button>`;
        }
      } else if (!logged) {
        actions += `<a class="btn btn-primary" href="/cabinet/login/">Войти</a>`;
      }

      body.innerHTML = `
        <div class="wgl-modal-hero">
          <img src="${esc(mediaUrl(u.avatar || DEFAULT_AVATAR))}" alt="">
          <div>
            <div class="profile-id">id${u.id}</div>
            <h2>${esc(u.nick)}</h2>
            <p class="profile-meta">место ${u.place || "—"} · очки ${u.rating} · друзей ${u.friendsCount || 0}</p>
          </div>
        </div>
        <div class="wgl-modal-actions">${actions}</div>`;

      body.querySelector("[data-add]")?.addEventListener("click", async () => {
        try {
          await api("/api/friends/request", { method: "POST", body: { userId: u.id } });
          openProfile(u.id);
        } catch (e) {
          alert(e.message);
        }
      });
      body.querySelector("[data-accept]")?.addEventListener("click", async () => {
        try {
          await api("/api/friends/accept", { method: "POST", body: { userId: u.id } });
          openProfile(u.id);
        } catch (e) {
          alert(e.message);
        }
      });
      body.querySelector("[data-gift]")?.addEventListener("click", () => {
        location.href = `/cabinet/?gift=${u.id}`;
      });
    } catch (e) {
      body.innerHTML = `<p>${esc(e.message)}</p>`;
    }
  }

  function bindNickClicks(root = document) {
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-user-id]");
      if (!a) return;
      e.preventDefault();
      openProfile(Number(a.dataset.userId));
    });
  }

  function nickHtml(userId, nick) {
    if (!userId) return `<b>${esc(nick)}</b>`;
    return `<a href="/id${userId}" data-user-id="${userId}" class="live-nick">${esc(nick)}</a>`;
  }

  function needAuth(msg) {
    let el = document.getElementById("wglAuthGate");
    if (!el) {
      el = document.createElement("div");
      el.id = "wglAuthGate";
      el.className = "wgl-auth-gate";
      el.hidden = true;
      el.innerHTML = `
        <div class="wgl-auth-gate__backdrop" data-close></div>
        <div class="wgl-auth-gate__panel" role="dialog" aria-modal="true" aria-labelledby="wglAuthGateTitle">
          <button type="button" class="wgl-auth-gate__x" data-close aria-label="Закрыть">×</button>
          <div class="wgl-auth-gate__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/>
              <path d="M4 20a8 8 0 0 1 16 0"/>
            </svg>
          </div>
          <h3 id="wglAuthGateTitle">Нужен аккаунт</h3>
          <p class="wgl-auth-gate__text" id="wglAuthGateText"></p>
          <div class="wgl-auth-gate__actions">
            <a class="btn btn-primary" href="/cabinet/login/">Войти</a>
            <a class="btn btn-ghost" href="/cabinet/register/">Регистрация</a>
          </div>
        </div>`;
      document.body.appendChild(el);
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-close]")) {
          el.hidden = true;
          document.body.classList.remove("auth-gate-open");
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !el.hidden) {
          el.hidden = true;
          document.body.classList.remove("auth-gate-open");
        }
      });
    }
    const text = el.querySelector("#wglAuthGateText");
    if (text) {
      text.textContent =
        msg ||
        "Писать сообщения могут только зарегистрированные пользователи. Войдите или создайте аккаунт.";
    }
    el.hidden = false;
    document.body.classList.add("auth-gate-open");
  }

  /** Шапка: «Войти» → аватар + ник + id после входа */
  async function paintTopbarAuth() {
    const cab = document.getElementById("cabLink");
    if (!cab) return;
    if (!token()) {
      cab.textContent = "Войти";
      cab.href = "/cabinet/login/";
      cab.classList.remove("topbar-user");
      return;
    }
    try {
      const data = await api("/api/me");
      const u = data.user;
      if (!u) throw new Error("no user");
      cab.className = "topbar-user";
      cab.href = "/cabinet/";
      cab.setAttribute("aria-label", `${u.nick}, id${u.id}`);
      cab.innerHTML = `
        <img class="topbar-user__av" src="${esc(mediaUrl(u.avatar || DEFAULT_AVATAR))}" alt="">
        <span class="topbar-user__meta">
          <strong class="topbar-user__nick">${esc(u.nick)}</strong>
          <span class="topbar-user__id">id${u.id}</span>
        </span>`;
    } catch {
      cab.textContent = "Кабинет";
      cab.href = "/cabinet/";
      cab.classList.remove("topbar-user");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      paintTopbarAuth();
    });
  } else {
    paintTopbarAuth();
  }

  return {
    api,
    apiBase,
    apiUrl,
    mediaUrl,
    wsUrl,
    token,
    esc,
    openProfile,
    bindNickClicks,
    nickHtml,
    close,
    paintTopbarAuth,
    needAuth,
    DEFAULT_AVATAR,
  };
})();
