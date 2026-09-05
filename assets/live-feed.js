/**
 * Общий чат проекта — внизу страницы.
 * Форма видна всем; писать могут только с аккаунтом.
 */
(function globalLiveFeed() {
  const root = document.getElementById("liveFeed");
  if (!root || !window.WGLSocial) return;

  const log = document.getElementById("liveLog");
  const form = document.getElementById("liveForm");
  const status = document.getElementById("liveStatus");
  const input = form?.querySelector('input[name="text"]');
  let ws = null;
  let stickBottom = true;

  function needAuth() {
    if (window.WGLSocial?.needAuth) {
      WGLSocial.needAuth(
        "Писать сообщения могут только зарегистрированные пользователи. Войдите или создайте аккаунт."
      );
      return;
    }
    location.href = "/cabinet/login/";
  }

  function renderMsg(msg) {
    const row = document.createElement("div");
    row.className = "live-msg" + (msg.system ? " is-system" : "");
    const time = msg.at ? new Date(msg.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
    if (msg.system) {
      row.innerHTML = `<div class="live-msg-body"><span class="live-system-text">${WGLSocial.esc(msg.text)}</span> <time>${WGLSocial.esc(time)}</time></div>`;
    } else {
      const av = WGLSocial.mediaUrl(msg.avatar || WGLSocial.DEFAULT_AVATAR);
      row.innerHTML = `
        <a class="live-av" href="/id${msg.userId}" data-user-id="${msg.userId}"><img src="${WGLSocial.esc(av)}" alt=""></a>
        <div class="live-msg-body">
          <div class="live-meta">
            ${WGLSocial.nickHtml(msg.userId, msg.nick)}
            <time>${WGLSocial.esc(time)}</time>
          </div>
          <div class="live-text">${WGLSocial.esc(msg.text)}</div>
        </div>`;
    }
    return row;
  }

  function append(msg) {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.appendChild(renderMsg(msg));
    if (stickBottom || near) log.scrollTop = log.scrollHeight;
  }

  async function loadHistory() {
    log.innerHTML = `<div class="live-empty">Загрузка…</div>`;
    try {
      const data = await fetch(WGLSocial.apiUrl("/api/chat/history")).then((r) => r.json());
      log.innerHTML = "";
      const msgs = data.messages || [];
      if (!msgs.length) log.innerHTML = `<div class="live-empty">Общий чат проекта. Напиши первым.</div>`;
      else msgs.forEach(append);
      log.scrollTop = log.scrollHeight;
      if (status) status.textContent = "общий чат";
    } catch {
      log.innerHTML = `<div class="live-empty">Чат временно недоступен</div>`;
    }
  }

  function connectWs() {
    if (ws) try { ws.close(); } catch { /* */ }
    ws = new WebSocket(WGLSocial.wsUrl());
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", room: "global" }));
      if (status) status.textContent = "в эфире";
    };
    ws.onclose = () => { if (status) status.textContent = "…"; };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "chat" && data.room === "global") {
          if (log.querySelector(".live-empty")) log.innerHTML = "";
          append(data.message);
        }
        if (data.type === "gift") {
          if (log.querySelector(".live-empty")) log.innerHTML = "";
          append({ system: true, text: data.text, at: data.at });
        }
      } catch { /* */ }
    };
  }

  log.addEventListener("scroll", () => {
    stickBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!WGLSocial.token()) {
      needAuth();
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    try {
      await WGLSocial.api("/api/chat", { method: "POST", body: { text } });
      input.value = "";
    } catch (err) {
      if (err.status === 401 || /вход|кабинет|зарегистр/i.test(err.message)) needAuth();
      else alert(err.message);
    }
  });

  WGLSocial.bindNickClicks(root);
  loadHistory();
  connectWs();
})();
