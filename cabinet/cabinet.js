const TOKEN_KEY = "wgl_token";

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

let me = null;
let ws = null;
let allAwards = [];
let voteBudget = { budget: 0, used: 0, left: 0, votes: {} };

if (!token()) {
  location.replace("/cabinet/login/");
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: {} });
  } catch {
    /* ignore */
  }
  setToken("");
  location.href = "/cabinet/login/";
});

document.querySelectorAll(".cab-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cab-nav-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    document.querySelectorAll(".cab-view").forEach((v) => {
      v.classList.toggle("is-active", v.dataset.view === btn.dataset.view);
    });
    const view = btn.dataset.view;
    if (view === "friends") refreshFriends();
    if (view === "dm") refreshDmList();
    if (view === "gifts") refreshGifts();
    if (view === "chat") refreshChat();
    if (view === "gamechats") refreshGameChats();
    if (view === "forum") {
      /* форум = живая лента */
    }
    if (view === "awards") refreshAwards();
    if (view === "rating") refreshRating();
    if (view === "votes") refreshVotes();
  });
});

function renderProfile(user, sessions = []) {
  me = user;
  voteBudget = user.voteBudget || voteBudget;
  const av = avatarUrl(user);
  document.getElementById("meAvatar").src = av;
  document.getElementById("profileAvatar").src = av;
  document.getElementById("meNick").textContent = user.nick;
  document.getElementById("meId").textContent = user.id;
  const placeEl = document.getElementById("mePlace");
  if (placeEl) placeEl.textContent = user.place || "—";
  document.getElementById("meRating").textContent = user.rating;

  const reg = new Date(user.registeredAt);
  const stats = user.stats || {};
  document.getElementById("profileStats").innerHTML = `
    <li><span>Профиль</span><strong><a href="/id${user.id}">/id${user.id}</a></strong></li>
    <li><span>Дата регистрации</span><strong>${reg.toLocaleString("ru-RU")}</strong></li>
    <li><span>Игровых сессий</span><strong>${stats.gamesPlayed || 0}</strong></li>
    <li><span>Голосов (бюджет)</span><strong>${voteBudget.budget || 0}</strong></li>
    <li><span>Бесплатных подарков</span><strong>${user.freeGiftsLeft ?? 1}</strong></li>
    <li><span>Сообщений</span><strong>${stats.messages || 0}</strong></li>
    <li><span>Время в играх</span><strong>${user.statsFormatted?.totalPlay || "0с"}</strong></li>
    <li><span>Место в рейтинге</span><strong>${user.place || "—"}</strong></li>
    <li><span>Очки рейтинга</span><strong>${user.rating}</strong></li>
    <li><span>Наград</span><strong>${(user.awards || []).length}</strong></li>
  `;

  const recv = user.giftsReceived || [];
  const giftsEl = document.getElementById("giftsReceived");
  if (giftsEl) {
    giftsEl.innerHTML = recv.length
      ? recv
          .slice()
          .reverse()
          .map(
            (g) => `
      <div class="cab-gift-chip" title="${escapeHtml(g.title)} от ${escapeHtml(g.fromNick)}">
        <img src="${escapeHtml(g.icon)}" alt="">
        <span>от <a href="/id${g.fromId}">${escapeHtml(g.fromNick)}</a></span>
      </div>`
          )
          .join("")
      : `<p class="cab-hint">Подарков пока нет</p>`;
  }

  const games = user.statsFormatted?.byGame || [];
  document.getElementById("gamesStats").innerHTML = games.length
    ? games
        .map(
          (g) => `
      <div class="cab-game-row">
        <strong>${escapeHtml(g.name)}</strong>
        <span>${g.sessions} игр</span>
        <span>${escapeHtml(g.playTime)}</span>
      </div>`
        )
        .join("")
    : `<p class="cab-hint">Пока нет сыгранных игр. Заходи в каталог под ЛК — время начнёт считаться.</p>`;

  document.getElementById("sessionsList").innerHTML = sessions
    .map(
      (s) => `
    <div class="cab-row">
      <div>
        <div>${s.current ? "Текущий сеанс" : "Другой сеанс"}</div>
        <div class="cab-hint">${new Date(s.lastSeen).toLocaleString("ru-RU")} · ${escapeHtml(s.ua || "")}</div>
      </div>
    </div>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.getElementById("avatarInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("Файл слишком большой — максимум 5 МБ");
    e.target.value = "";
    return;
  }
  const fd = new FormData();
  fd.append("avatar", file);
  try {
    const data = await api("/api/avatar", { method: "POST", body: fd });
    renderProfile(data.user, (await api("/api/me")).sessions);
  } catch (err) {
    alert(err.message);
  } finally {
    e.target.value = "";
  }
});

async function refreshFriends() {
  const data = await api("/api/friends");
  const list = document.getElementById("friendsList");
  const incoming = document.getElementById("friendIncoming");

  incoming.innerHTML = data.incoming.length
    ? data.incoming
        .map(
          (u) => `
      <div class="cab-row">
        <div class="cab-row-user">
          <img src="${avatarUrl(u)}" alt="">
          <div><strong>${escapeHtml(u.nick)}</strong><div class="cab-hint">ID ${u.id} · ${u.rating}</div></div>
        </div>
        <button class="btn btn-primary" type="button" data-accept="${u.id}">Принять</button>
      </div>`
        )
        .join("")
    : `<p class="cab-hint">Нет входящих заявок</p>`;

  list.innerHTML = data.friends.length
    ? data.friends
        .map(
          (u) => `
      <div class="cab-row">
        <div class="cab-row-user">
          <img src="${avatarUrl(u)}" alt="">
          <div><strong><a href="/id${u.id}">${escapeHtml(u.nick)}</a></strong><div class="cab-hint">ID ${u.id} · рейтинг ${u.rating}</div></div>
        </div>
        <div class="cab-row-actions">
          <button class="btn btn-ghost" type="button" data-dm="${u.id}">ЛС</button>
          <button class="btn btn-ghost" type="button" data-gift="${u.id}">Подарок</button>
          <button class="btn btn-ghost" type="button" data-remove="${u.id}">Удалить</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="cab-hint">Пока нет друзей</p>`;

  incoming.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/accept", { method: "POST", body: { userId: Number(btn.dataset.accept) } });
      refreshFriends();
    });
  });
  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/friends/remove", { method: "POST", body: { userId: Number(btn.dataset.remove) } });
      refreshFriends();
    });
  });
  list.querySelectorAll("[data-dm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector('.cab-nav-btn[data-view="dm"]').click();
      openDm(Number(btn.dataset.dm));
    });
  });
  list.querySelectorAll("[data-gift]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector('.cab-nav-btn[data-view="gifts"]').click();
      const input = document.querySelector('#giftSendForm [name="toUserId"]');
      if (input) input.value = btn.dataset.gift;
    });
  });
}

document.getElementById("friendSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = new FormData(e.target).get("q");
  const data = await api(`/api/friends/search?q=${encodeURIComponent(q)}`);
  const box = document.getElementById("friendSearchResults");
  box.innerHTML = data.results.length
    ? data.results
        .map(
          (u) => `
      <div class="cab-row">
        <div class="cab-row-user">
          <img src="${avatarUrl(u)}" alt="">
          <div><strong>${escapeHtml(u.nick)}</strong><div class="cab-hint">ID ${u.id} · рейтинг ${u.rating}</div></div>
        </div>
        <button class="btn btn-primary" type="button" data-add="${u.id}">В друзья</button>
      </div>`
        )
        .join("")
    : `<p class="cab-hint">Никого не найдено</p>`;
  box.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api("/api/friends/request", { method: "POST", body: { userId: Number(btn.dataset.add) } });
        btn.textContent = "Отправлено";
        btn.disabled = true;
        refreshFriends();
      } catch (err) {
        alert(err.message);
      }
    });
  });
});

function appendChat(msg) {
  const log = document.getElementById("chatLog");
  if (!log) return;
  if (msg.system) {
    const div = document.createElement("div");
    div.className = "cab-chat-msg";
    div.innerHTML = `<span style="color:var(--accent-hot)">${escapeHtml(msg.text)}</span> <span class="cab-hint">${new Date(msg.at).toLocaleTimeString("ru-RU")}</span>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return;
  }
  const div = document.createElement("div");
  div.className = "cab-chat-msg";
  div.innerHTML = `<b><a href="/id${msg.userId}">${escapeHtml(msg.nick)}</a></b>: ${escapeHtml(msg.text)} <span class="cab-hint">${new Date(msg.at).toLocaleTimeString("ru-RU")}</span>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function refreshChat() {
  const data = await api("/api/chat/history");
  const log = document.getElementById("chatLog");
  log.innerHTML = "";
  data.messages.forEach(appendChat);
  connectWs();
}

function connectWs() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "chat") appendChat(data.message);
    } catch {
      /* ignore */
    }
  };
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/chat", { method: "POST", body: { text: fd.get("text") } });
    e.target.reset();
  } catch (err) {
    alert(err.message);
  }
});

async function refreshForum() {
  const data = await api("/api/forum/threads");
  const box = document.getElementById("threadsList");
  document.getElementById("threadView").hidden = true;
  box.hidden = false;
  box.innerHTML = data.threads.length
    ? data.threads
        .map(
          (t) => `
      <button type="button" class="cab-row" data-thread="${t.id}" style="width:100%;cursor:pointer;text-align:left;font:inherit;color:inherit;background:rgba(0,0,0,.12)">
        <div>
          <strong>${escapeHtml(t.title)}</strong>
          <div class="cab-hint">${escapeHtml(t.authorNick)} · ${t.postsCount || 1} сообщ.</div>
        </div>
      </button>`
        )
        .join("")
    : `<p class="cab-hint">Тем пока нет — создай первую</p>`;
  box.querySelectorAll("[data-thread]").forEach((btn) => {
    btn.addEventListener("click", () => openThread(btn.dataset.thread));
  });
}

async function openThread(id) {
  const data = await api(`/api/forum/threads/${id}`);
  const view = document.getElementById("threadView");
  document.getElementById("threadsList").hidden = true;
  view.hidden = false;
  const t = data.thread;
  view.innerHTML = `
    <button type="button" class="btn btn-ghost" id="backThreads">← К темам</button>
    <h3>${escapeHtml(t.title)}</h3>
    <div>${t.posts
      .map(
        (p) => `
      <div class="cab-post">
        <strong>${escapeHtml(p.authorNick)}</strong>
        <span class="cab-hint">${new Date(p.at).toLocaleString("ru-RU")}</span>
        <p>${escapeHtml(p.body)}</p>
      </div>`
      )
      .join("")}</div>
    <form id="replyForm" class="cab-form compact">
      <textarea name="body" rows="3" maxlength="4000" required placeholder="Ответ…"></textarea>
      <button class="btn btn-primary" type="submit">Ответить</button>
    </form>`;
  document.getElementById("backThreads").onclick = () => refreshForum();
  document.getElementById("replyForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = new FormData(e.target).get("body");
    try {
      await api(`/api/forum/threads/${id}/posts`, { method: "POST", body: { body } });
      openThread(id);
    } catch (err) {
      alert(err.message);
    }
  };
}

document.getElementById("threadForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/forum/threads", {
      method: "POST",
      body: { title: fd.get("title"), body: fd.get("body") },
    });
    e.target.reset();
    refreshForum();
  } catch (err) {
    alert(err.message);
  }
});

async function refreshAwards() {
  if (!allAwards.length) {
    allAwards = (await api("/api/awards")).awards;
  }
  const owned = new Set((me.awards || []).map((a) => a.id));
  document.getElementById("awardsGrid").innerHTML = allAwards
    .map(
      (a) => `
    <div class="cab-award ${owned.has(a.id) ? "owned" : ""}">
      <img src="${a.icon}" alt="">
      <strong>${escapeHtml(a.title)}</strong>
      <span>${escapeHtml(a.desc)}</span>
    </div>`
    )
    .join("");
}

async function refreshRating() {
  const data = await api("/api/rating?limit=1000");
  document.getElementById("ratingList").innerHTML = data.rating
    .map(
      (u) => `
    <div class="cab-row">
      <div class="cab-row-user">
        <span class="cab-hint">топ ${u.place}</span>
        <img src="${avatarUrl(u)}" alt="">
        <div><strong>${escapeHtml(u.nick)}</strong><div class="cab-hint">ID ${u.id} · очки ${u.rating}</div></div>
      </div>
      <strong>${u.place}</strong>
    </div>`
    )
    .join("");
}

function renderBudgetBar(vb) {
  voteBudget = vb || voteBudget;
  document.getElementById("voteBudgetBar").innerHTML = `
    <strong>Бюджет:</strong> ${voteBudget.budget}
    · <strong>потрачено:</strong> ${voteBudget.used}
    · <strong>свободно:</strong> ${voteBudget.left}
    <span class="cab-hint"> (1 игра = 1 голос)</span>`;
}

async function refreshVotes() {
  const data = await api("/api/games");
  if (data.voteBudget) renderBudgetBar(data.voteBudget);
  else if (me?.voteBudget) renderBudgetBar(me.voteBudget);

  document.getElementById("votesList").innerHTML = data.games
    .map((g) => {
      const mine = Number(g.myVotes || 0);
      return `
    <div class="cab-vote-card">
      <div>
        <strong>${escapeHtml(g.name)}</strong>
        <div class="cab-hint">${escapeHtml(g.blurb)} · на карточке ★ ${g.score} · ваши: ${mine}</div>
      </div>
      <div class="cab-vote-actions">
        <button type="button" data-vote="${g.id}" data-delta="-1" title="Убрать 1">−</button>
        <input class="cab-vote-input" type="number" min="0" value="${mine}" data-amount-for="${g.id}" aria-label="Голосов на ${escapeHtml(g.name)}">
        <button type="button" data-vote="${g.id}" data-delta="1" title="Добавить 1">+</button>
        <button type="button" class="btn btn-ghost" data-set="${g.id}">OK</button>
      </div>
    </div>`;
    })
    .join("");

  document.querySelectorAll("#votesList [data-delta]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.vote;
      const input = document.querySelector(`[data-amount-for="${id}"]`);
      const next = Math.max(0, Number(input.value || 0) + Number(btn.dataset.delta));
      await setVotes(id, next);
    });
  });
  document.querySelectorAll("#votesList [data-set]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.set;
      const input = document.querySelector(`[data-amount-for="${id}"]`);
      await setVotes(id, Number(input.value || 0));
    });
  });
}

async function setVotes(gameId, amount) {
  try {
    const res = await api(`/api/games/${gameId}/vote`, {
      method: "POST",
      body: { amount },
    });
    if (res.voteBudget) {
      me.voteBudget = res.voteBudget;
      me.votes = res.voteBudget.votes;
    }
    refreshVotes();
  } catch (err) {
    alert(err.message);
    refreshVotes();
  }
}

document.getElementById("resetVotesBtn").addEventListener("click", async () => {
  if (!confirm("Вернуть все голоса с карточек?")) return;
  try {
    const res = await api("/api/votes/reset", { method: "POST", body: {} });
    if (res.voteBudget) me.voteBudget = res.voteBudget;
    refreshVotes();
  } catch (err) {
    alert(err.message);
  }
});

async function bootApp() {
  const data = await api("/api/me");
  renderProfile(data.user, data.sessions);
  connectWs();

  const q = new URLSearchParams(location.search);
  if (q.get("dm")) {
    document.querySelector('.cab-nav-btn[data-view="dm"]')?.click();
    openDm(Number(q.get("dm")));
  } else if (q.get("gift")) {
    document.querySelector('.cab-nav-btn[data-view="gifts"]')?.click();
    const input = document.querySelector('#giftSendForm [name="toUserId"]');
    if (input) input.value = q.get("gift");
  }
}

let dmPeerId = null;
let selectedGiftId = "bear_hug";
let activeGameCode = "";

async function refreshDmList() {
  const data = await api("/api/dm");
  const box = document.getElementById("dmList");
  box.innerHTML = (data.conversations || []).length
    ? data.conversations
        .map(
          (c) => `
      <button type="button" class="cab-row" data-peer="${c.peerId}" style="width:100%;cursor:pointer;text-align:left;font:inherit;color:inherit;background:rgba(0,0,0,.12)">
        <div class="cab-row-user">
          <img src="${avatarUrl(c.peer)}" alt="">
          <div><strong>${escapeHtml(c.peer.nick)}</strong><div class="cab-hint">${escapeHtml(c.preview || "")}</div></div>
        </div>
      </button>`
        )
        .join("")
    : `<p class="cab-hint">Диалогов пока нет — напиши другу из раздела Друзья</p>`;
  box.querySelectorAll("[data-peer]").forEach((btn) => {
    btn.addEventListener("click", () => openDm(Number(btn.dataset.peer)));
  });
}

async function openDm(peerId) {
  dmPeerId = peerId;
  const data = await api(`/api/dm/${peerId}`);
  document.getElementById("dmPeerTitle").innerHTML = `Чат с <a href="/id${data.peer.id}">${escapeHtml(data.peer.nick)}</a>`;
  const log = document.getElementById("dmLog");
  log.innerHTML = "";
  (data.messages || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = "cab-chat-msg";
    div.innerHTML = `<b>${escapeHtml(m.nick)}</b>: ${escapeHtml(m.text)} <span class="cab-hint">${new Date(m.at).toLocaleTimeString("ru-RU")}</span>`;
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
  document.getElementById("dmForm").hidden = !data.isFriend;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "join", room: `dm:${me.id}` }));
  }
}

document.getElementById("dmForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!dmPeerId) return;
  const text = new FormData(e.target).get("text");
  try {
    await api(`/api/dm/${dmPeerId}`, { method: "POST", body: { text } });
    e.target.reset();
    openDm(dmPeerId);
    refreshDmList();
  } catch (err) {
    alert(err.message);
  }
});

async function refreshGifts() {
  const data = await api("/api/gifts");
  document.getElementById("giftFreeLeft").innerHTML = `Бесплатных подарков осталось: <strong>${data.freeGiftsLeft ?? me?.freeGiftsLeft ?? 0}</strong>`;
  const cat = document.getElementById("giftsCatalog");
  cat.innerHTML = (data.gifts || [])
    .map((g) => {
      const locked = !g.available;
      return `
      <label class="cab-gift-card ${locked ? "is-locked" : ""} ${selectedGiftId === g.id ? "is-selected" : ""}">
        <input type="radio" name="giftId" value="${g.id}" ${locked ? "disabled" : ""} ${selectedGiftId === g.id && !locked ? "checked" : ""}>
        <img src="${escapeHtml(g.icon)}" alt="">
        <strong>${escapeHtml(g.title)}</strong>
        <span>${g.free ? "Бесплатно" : `${g.priceRub} ₽ · скоро`}</span>
      </label>`;
    })
    .join("");
  cat.querySelectorAll('input[name="giftId"]').forEach((inp) => {
    inp.addEventListener("change", () => {
      selectedGiftId = inp.value;
      cat.querySelectorAll(".cab-gift-card").forEach((c) => c.classList.toggle("is-selected", c.querySelector("input")?.value === selectedGiftId));
    });
  });

  const sent = me.giftsSent || [];
  document.getElementById("giftsSentList").innerHTML = sent.length
    ? sent
        .slice()
        .reverse()
        .map(
          (g) => `
      <div class="cab-row">
        <div class="cab-row-user">
          <img src="${escapeHtml(g.icon)}" alt="" style="width:36px;height:36px;border-radius:8px">
          <div><strong>${escapeHtml(g.title)}</strong><div class="cab-hint">→ <a href="/id${g.toId}">${escapeHtml(g.toNick)}</a></div></div>
        </div>
      </div>`
        )
        .join("")
    : `<p class="cab-hint">Ещё ничего не дарил</p>`;
}

document.getElementById("giftSendForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const giftId = fd.get("giftId") || selectedGiftId;
  try {
    const res = await api("/api/gifts/send", {
      method: "POST",
      body: { giftId, toUserId: Number(fd.get("toUserId")) },
    });
    me = res.user;
    renderProfile(me, (await api("/api/me")).sessions);
    refreshGifts();
    alert("Подарок отправлен!");
  } catch (err) {
    alert(err.message);
  }
});

async function refreshGameChats() {
  const games = (await api("/api/games")).games || [];
  const pick = document.getElementById("gameChatPick");
  if (!activeGameCode && games[0]) activeGameCode = games[0].code;
  pick.innerHTML = games
    .map(
      (g) =>
        `<button type="button" class="${g.code === activeGameCode ? "is-on" : ""}" data-code="${g.code}">${escapeHtml(g.name)}</button>`
    )
    .join("");
  pick.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      activeGameCode = btn.dataset.code;
      loadGameChatRoom();
    };
  });
  loadGameChatRoom();
}

async function loadGameChatRoom() {
  if (!activeGameCode) return;
  document.querySelectorAll("#gameChatPick button").forEach((b) => b.classList.toggle("is-on", b.dataset.code === activeGameCode));
  const data = await api(`/api/chat/game/${activeGameCode}/history`);
  const log = document.getElementById("gameChatLog");
  log.innerHTML = "";
  (data.messages || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = "cab-chat-msg";
    div.innerHTML = `<b><a href="/id${m.userId}">${escapeHtml(m.nick)}</a></b>: ${escapeHtml(m.text)} <span class="cab-hint">${new Date(m.at).toLocaleTimeString("ru-RU")}</span>`;
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "join", room: `game:${activeGameCode}` }));
  }
}

document.getElementById("gameChatForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeGameCode) return;
  const text = new FormData(e.target).get("text");
  try {
    await api(`/api/chat/game/${activeGameCode}`, { method: "POST", body: { text } });
    e.target.reset();
    loadGameChatRoom();
  } catch (err) {
    alert(err.message);
  }
});

const _oldConnect = typeof connectWs === "function" ? connectWs : null;
function connectWsPatched() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", room: "global" }));
    if (me?.id) ws.send(JSON.stringify({ type: "join", room: `dm:${me.id}` }));
  };
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "chat" && data.room === "global") appendChat(data.message);
      if (data.type === "chat" && data.room === `game:${activeGameCode}`) {
        const log = document.getElementById("gameChatLog");
        if (log) {
          const div = document.createElement("div");
          div.className = "cab-chat-msg";
          div.innerHTML = `<b>${escapeHtml(data.message.nick)}</b>: ${escapeHtml(data.message.text)}`;
          log.appendChild(div);
          log.scrollTop = log.scrollHeight;
        }
      }
      if (data.type === "dm" && data.message && (data.message.fromId === dmPeerId || data.message.toId === dmPeerId)) {
        openDm(dmPeerId);
      }
    } catch {
      /* ignore */
    }
  };
}
connectWs = connectWsPatched;

bootApp().catch(() => {
  setToken("");
  location.replace("/cabinet/login/");
});
