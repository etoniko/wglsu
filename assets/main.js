const FALLBACK_GAMES = [
  { code: "agars", id: "agar-su", name: "Agar.su", url: "https://agar.su/", zone: ".su", video: "./video/agarsu.mp4", img: "./photo/agar-su.jpg", blurb: "Классика агарио", score: 0 },
  { code: "agrio", id: "agario-rf", name: "Агарио.рф", url: "https://агарио.рф/", zone: ".рф", video: "./video/agario-rf.mp4", img: "./photo/agario-rf.jpg", blurb: "Агарио на русском", score: 0 },
  { code: "zonex", id: "zonex-su", name: "ZoneX.su", url: "https://zonex.su/", zone: ".su", video: "./video/zonex-su.mp4", img: "./photo/zonex-su.jpg", blurb: "Зона контроля", score: 0 },
  { code: "clers", id: "cler-su", name: "Cler.su", url: "https://cler.su/", zone: ".su", video: "./video/cler-su.mp4", img: "./photo/cler-su.jpg", blurb: "Быстрый экшен", score: 0 },
  { code: "slith", id: "slither-su", name: "Slither.su", url: "https://slither.su/", zone: ".su", video: "./video/slither-su.mp4", img: "./photo/slither-su.jpg", blurb: "Змейки онлайн", score: 0 },
];

let games = [...FALLBACK_GAMES];
let gameChatWs = null;
let openGameCode = null;
let voteBudget = { budget: 0, used: 0, left: 0, votes: {} };

function needAuth(msg) {
  if (window.WGLSocial?.needAuth) return WGLSocial.needAuth(msg);
  alert(msg || "Нужен вход в аккаунт.");
  location.href = "/cabinet/login/";
}

function playUrl(game) {
  if (typeof game === "string") return `/g/${game}`;
  return game.play || `/g/${game.code || game.id}`;
}

const CHAT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.5-4.4A8.4 8.4 0 0 1 3.5 12 8.5 8.5 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>`;
const STAR_ICON = `<span class="material-symbols-rounded card-star__glyph" aria-hidden="true">grade</span>`;

function placeholderHTML(game) {
  return `
    <div class="media-placeholder" aria-hidden="true">
      <div>
        <div class="ph-domain">${game.name}</div>
        <div class="ph-hint">скоро скрин / видео</div>
      </div>
    </div>`;
}

function mediaHTML(game) {
  const fallback = placeholderHTML(game);
  if (game.video) {
    return `${fallback}<video class="thumb" autoplay loop muted playsinline preload="metadata" poster="${game.img || ""}" data-media="video"><source src="${game.video}" type="video/mp4"></video>`;
  }
  if (game.img) {
    return `${fallback}<img class="thumb" src="${game.img}" alt="${game.name}" loading="lazy" data-media="img">`;
  }
  return fallback;
}

function esc(s) {
  return window.WGLSocial ? WGLSocial.esc(s) : String(s || "");
}

function ensureGameChatModal() {
  let el = document.getElementById("gameChatModal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "gameChatModal";
  el.className = "game-chat-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="game-chat-modal__backdrop" data-close></div>
    <div class="game-chat-modal__panel" role="dialog" aria-modal="true" aria-labelledby="gameChatTitle">
      <header class="game-chat-modal__head">
        <div>
          <div class="game-chat-modal__label">Чат игры</div>
          <h3 id="gameChatTitle">—</h3>
        </div>
        <button type="button" class="game-chat-modal__x" data-close aria-label="Закрыть">×</button>
      </header>
      <div class="game-chat-modal__log" id="gameChatLog"></div>
      <form class="game-chat-modal__form" id="gameChatForm">
        <input name="text" maxlength="400" placeholder="Сообщение…" autocomplete="off" required>
        <button type="submit" class="btn btn-primary">Отправить</button>
      </form>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeGameChat();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) closeGameChat();
  });

  el.querySelector("#gameChatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!openGameCode) return;
    if (!WGLSocial.token()) {
      needAuth("Писать сообщения могут только зарегистрированные пользователи. Войдите или создайте аккаунт.");
      return;
    }
    const text = new FormData(e.target).get("text");
    try {
      await WGLSocial.api(`/api/chat/game/${openGameCode}`, { method: "POST", body: { text } });
      e.target.reset();
    } catch (err) {
      alert(err.message);
    }
  });

  return el;
}

function appendGameMsg(log, msg) {
  const div = document.createElement("div");
  div.className = "card-chat-msg";
  const nick = WGLSocial.nickHtml(msg.userId, msg.nick);
  const time = msg.at ? new Date(msg.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
  div.innerHTML = `${nick}: ${esc(msg.text)} <time>${esc(time)}</time>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function closeGameChat() {
  const el = document.getElementById("gameChatModal");
  if (el) el.hidden = true;
  document.body.classList.remove("modal-open");
  openGameCode = null;
  if (gameChatWs) {
    try {
      gameChatWs.close();
    } catch {
      /* */
    }
    gameChatWs = null;
  }
  document.querySelectorAll(".card-btn-chat").forEach((b) => b.classList.remove("is-on"));
}

async function openGameChat(game) {
  const code = game.code || game.id;
  const modal = ensureGameChatModal();
  const log = modal.querySelector("#gameChatLog");
  openGameCode = code;
  modal.querySelector("#gameChatTitle").textContent = game.name;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.querySelectorAll(".card-btn-chat").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.chat === code);
  });

  log.innerHTML = `<div class="live-empty">Загрузка…</div>`;
  try {
    const data = await fetch(WGLSocial.apiUrl(`/api/chat/game/${code}/history`)).then((r) => r.json());
    log.innerHTML = "";
    const msgs = data.messages || [];
    if (!msgs.length) log.innerHTML = `<div class="live-empty">Пока тихо — напиши первым</div>`;
    else msgs.forEach((m) => appendGameMsg(log, m));
  } catch {
    log.innerHTML = `<div class="live-empty">Чат недоступен</div>`;
  }

  if (gameChatWs) {
    try {
      gameChatWs.close();
    } catch {
      /* */
    }
  }
  gameChatWs = new WebSocket(WGLSocial.wsUrl());
  gameChatWs.onopen = () => gameChatWs.send(JSON.stringify({ type: "join", room: `game:${code}` }));
  gameChatWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "chat" && data.room === `game:${code}`) {
        if (log.querySelector(".live-empty")) log.innerHTML = "";
        appendGameMsg(log, data.message);
      }
    } catch {
      /* */
    }
  };

  if (window.WGLSocial) WGLSocial.bindNickClicks(modal);
}

function buildGrid(list) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="empty">Ничего не найдено</div>`;
    return;
  }

  list.forEach((g, i) => {
    const card = document.createElement("article");
    card.className = "game-card";
    card.style.animationDelay = `${i * 60}ms`;
    const score = Number(g.score) || 0;
    const code = g.code || g.id;
    const mine = Number(g.myVotes) || 0;

    card.innerHTML = `
      <div class="media">
        <span class="zone-badge">${g.zone}</span>
        ${mediaHTML(g)}
      </div>
      <div class="info">
        <div class="title-block">
          <div class="title-row">
            <div class="title">${g.name}</div>
            <button type="button" class="card-star${mine > 0 ? " is-on" : ""}" data-klass title="Рейтинг карточки" aria-label="Поставить звезду, рейтинг ${score}">
              <span class="card-star__icon">${STAR_ICON}</span>
              <span class="card-star__n">${score}</span>
            </button>
          </div>
          <div class="meta">${g.blurb}</div>
        </div>
      </div>
      <div class="card-actions">
        <button type="button" class="card-btn card-btn-chat" data-chat="${code}" aria-label="Чат ${g.name}">
          ${CHAT_ICON}<span>Чат</span>
        </button>
        <a class="card-btn card-btn-play" href="${playUrl(g)}" aria-label="Играть в ${g.name}">
          ${PLAY_ICON}<span>Играть</span>
        </a>
      </div>`;

    const media = card.querySelector(".media");
    const thumb = media.querySelector("[data-media]");
    const ph = media.querySelector(".media-placeholder");
    if (thumb && ph) {
      ph.style.zIndex = "1";
      const reveal = () => ph.remove();
      const fail = () => thumb.remove();
      if (thumb.tagName === "VIDEO") {
        thumb.addEventListener("loadeddata", reveal, { once: true });
        thumb.addEventListener("error", fail, { once: true });
        thumb.querySelector("source")?.addEventListener("error", fail, { once: true });
      } else if (thumb.complete && thumb.naturalWidth) reveal();
      else {
        thumb.addEventListener("load", reveal, { once: true });
        thumb.addEventListener("error", fail, { once: true });
      }
    }

    card.querySelector("[data-chat]").addEventListener("click", () => openGameChat(g));
    card.querySelector("[data-klass]")?.addEventListener("click", () => klassOnCard(g.id));
    grid.appendChild(card);
  });
}

async function klassOnCard(gameId) {
  if (!window.WGLSocial?.token?.()) {
    needAuth("Ставить звезду могут только зарегистрированные. Войдите или создайте аккаунт.");
    return;
  }
  const g = games.find((x) => x.id === gameId || x.code === gameId);
  if (!g) return;
  try {
    const res = await WGLSocial.api(`/api/games/${g.id}/vote`, {
      method: "POST",
      body: { action: "klass" },
    });
    if (res.games) games = res.games;
    if (res.voteBudget) voteBudget = res.voteBudget;
    const term = document.getElementById("search")?.value.trim().toLowerCase() || "";
    const list = term
      ? games.filter((x) => `${x.name} ${x.url} ${x.blurb} ${x.zone} ${x.code || ""}`.toLowerCase().includes(term))
      : games;
    buildGrid(list);
  } catch (err) {
    if (err.status === 401) needAuth("Ставить звезду могут только зарегистрированные. Войдите или создайте аккаунт.");
    else alert(err.message);
  }
}
const search = document.getElementById("search");
if (search) {
  search.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    buildGrid(games.filter((g) => `${g.name} ${g.url} ${g.blurb} ${g.zone} ${g.code || ""}`.toLowerCase().includes(term)));
  });
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

(function initScrollIndicator() {
  const rail = document.getElementById("scroll-indicator");
  const thumb = document.getElementById("scroll-thumb");
  if (!rail || !thumb) return;
  let hideTimer = 0;
  function update() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docH = document.documentElement.scrollHeight;
    const viewH = window.innerHeight;
    const max = Math.max(docH - viewH, 1);
    if (docH <= viewH + 2) {
      rail.classList.remove("is-visible");
      return;
    }
    const thumbH = Math.max((viewH / docH) * viewH, 48);
    const top = (scrollTop / max) * (viewH - thumbH);
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
    rail.classList.add("is-visible");
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => rail.classList.remove("is-visible"), 900);
  }
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
})();

async function loadGames() {
  try {
    const headers = {};
    if (window.WGLSocial?.token?.()) headers.Authorization = `Bearer ${WGLSocial.token()}`;
    const res = await fetch(WGLSocial.apiUrl("/api/games"), { headers });
    if (!res.ok) throw new Error("api");
    const data = await res.json();
    if (data.ok && Array.isArray(data.games) && data.games.length) games = data.games;
    if (data.voteBudget) voteBudget = data.voteBudget;
  } catch {
    /* fallback */
  }
  buildGrid(games);
}

loadGames();
initTheme();
if (window.WGLSocial) WGLSocial.bindNickClicks(document);

(async function loadTopPlayers() {
  const box = document.getElementById("topPlayers");
  if (!box) return;
  try {
    const data = await fetch(WGLSocial.apiUrl("/api/rating?limit=3")).then((r) => r.json());
    const list = data.rating || [];
    if (!list.length) {
      box.innerHTML = `<p class="cab-hint">Пока пусто — сыграй и напиши в чат</p>`;
      return;
    }

    const medals = {
      1: { cls: "is-gold", label: "золото" },
      2: { cls: "is-silver", label: "серебро" },
      3: { cls: "is-bronze", label: "бронза" },
    };

    function card(u, place) {
      const meta = medals[place] || medals[3];
      if (!u) {
        return `
          <div class="top-player ${meta.cls} is-empty" aria-hidden="true">
            <div class="top-player__medal" aria-hidden="true"><span></span></div>
            <div class="top-player__av-wrap"><span class="top-player__av-ph"></span></div>
            <strong class="top-player__nick">—</strong>
            <span class="top-player__score">${meta.label}</span>
            <div class="top-player__pedestal"><span>топ ${place}</span></div>
          </div>`;
      }
      const av = window.WGLSocial
        ? WGLSocial.mediaUrl(u.avatar || WGLSocial.DEFAULT_AVATAR)
        : u.avatar || "/assets/default-avatar.png";
      const nick = window.WGLSocial ? WGLSocial.esc(u.nick) : u.nick;
      return `
        <a class="top-player ${meta.cls}" href="/id${u.id}" data-user-id="${u.id}">
          <div class="top-player__medal" aria-hidden="true"><span></span></div>
          <div class="top-player__av-wrap">
            <img src="${av}" alt="">
          </div>
          <strong class="top-player__nick">${nick}</strong>
          <span class="top-player__score">${u.rating} очк.</span>
          <div class="top-player__pedestal"><span>топ ${place}</span></div>
        </a>`;
    }

    const byPlace = { 1: list[0] || null, 2: list[1] || null, 3: list[2] || null };
    // подиум: 2 | 1 | 3
    box.classList.add("top-players--podium");
    box.innerHTML = card(byPlace[2], 2) + card(byPlace[1], 1) + card(byPlace[3], 3);
    if (window.WGLSocial) WGLSocial.bindNickClicks(box);
  } catch {
    box.innerHTML = "";
  }
})();

