/** Запуск: iframe 100%×100% через CSS, поверх только таймер */
(function () {
  const LOCAL_GAMES = {
    agars: { code: "agars", id: "agar-su", name: "Agar.su", url: "https://agar.su/" },
    agrio: { code: "agrio", id: "agario-rf", name: "Агарио.рф", url: "https://агарио.рф/" },
    zonex: { code: "zonex", id: "zonex-su", name: "ZoneX.su", url: "https://zonex.su/" },
    clers: { code: "clers", id: "cler-su", name: "Cler.su", url: "https://cler.su/" },
    slith: { code: "slith", id: "slither-su", name: "Slither.su", url: "https://slither.su/" },
  };

  const iframe = document.getElementById("gameFrame");
  const stage = document.getElementById("gameStage");
  const status = document.getElementById("status");
  const message = status?.querySelector(".message");
  const playTimer = document.getElementById("playTimer");
  const playTimerValue = document.getElementById("playTimerValue");
  const notFound = document.getElementById("notFound");

  function apiBase() {
    const h = location.hostname;
    if (h === "wgl.su" || h === "www.wgl.su" || h.endsWith("github.io")) {
      return "https://sixz.ru";
    }
    return "";
  }
  function apiUrl(path) {
    return apiBase() + path;
  }

  function goHome() {
    location.href = "/";
  }

  function codeFromPath() {
    const m = location.pathname.match(/\/g\/([a-zA-Z0-9]{3,8})\/?$/);
    if (m) return m[1].toLowerCase();
    const q = new URLSearchParams(location.search);
    return (q.get("game") || q.get("code") || "").toLowerCase();
  }

  function formatTimer(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  async function resolveFromApi(code) {
    const res = await fetch(apiUrl(`/api/g/${encodeURIComponent(code)}`));
    if (!res.ok) return null;
    const data = await res.json();
    return data.game || null;
  }

  function showGame(url) {
    if (!iframe || !status) return;
    let loaded = false;

    stage.classList.add("is-on");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
      "allow",
      "fullscreen; autoplay; gamepad; accelerometer; gyroscope; clipboard-write"
    );
    iframe.setAttribute("referrerpolicy", "origin");

    const u = new URL(url, location.href);
    if (!u.searchParams.has("embed")) u.searchParams.set("embed", "1");
    iframe.src = u.toString();

    iframe.onload = () => {
      loaded = true;
      status.style.display = "none";
    };
    iframe.onerror = () => {
      if (message) message.textContent = "Ошибка загрузки\nВозврат на главную…";
      setTimeout(goHome, 2500);
    };
    setTimeout(() => {
      if (!loaded) {
        status.style.display = "none";
        stage.classList.add("is-on");
      }
    }, 2500);
  }

  function startPlayTrackingSafe(game) {
    const token = localStorage.getItem("wgl_token");
    if (!token || !game || !playTimer) return;

    playTimer.classList.add("is-on");
    let sessionMs = 0;
    if (playTimerValue) playTimerValue.textContent = formatTimer(0);

    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };

    fetch(apiUrl("/api/play/start"), {
      method: "POST",
      headers,
      body: JSON.stringify({ gameId: game.code || game.id, url: game.url }),
    }).catch(() => {});

    const tick = setInterval(() => {
      if (document.hidden) return;
      sessionMs += 1000;
      if (playTimerValue) playTimerValue.textContent = formatTimer(sessionMs);
    }, 1000);

    let lastBeat = Date.now();
    setInterval(() => {
      if (document.hidden) {
        lastBeat = Date.now();
        return;
      }
      const now = Date.now();
      const deltaMs = now - lastBeat;
      lastBeat = now;
      fetch(apiUrl("/api/play/heartbeat"), {
        method: "POST",
        headers,
        body: JSON.stringify({ game: game.code || game.id, deltaMs }),
      }).catch(() => {});
    }, 30000);

    window.addEventListener("beforeunload", () => clearInterval(tick));
  }

  function showNotFoundPage() {
    if (notFound) notFound.hidden = false;
    if (status) status.style.display = "none";
    if (stage) stage.classList.remove("is-on");
    if (playTimer) playTimer.style.display = "none";
  }

  async function boot() {
    const code = codeFromPath();
    if (!code) {
      showNotFoundPage();
      return;
    }
    if (notFound) notFound.hidden = true;

    const local = LOCAL_GAMES[code];
    if (local) {
      document.title = `${local.name} — wgl.su`;
      if (message) message.textContent = `Запуск ${local.name}…`;
      showGame(local.url);
      startPlayTrackingSafe(local);
      resolveFromApi(code).catch(() => {});
      return;
    }

    try {
      const game = await resolveFromApi(code);
      if (!game) {
        if (message) message.textContent = "Игра не найдена\nВозврат на главную…";
        setTimeout(goHome, 2200);
        return;
      }
      document.title = `${game.name} — wgl.su`;
      showGame(game.url);
      startPlayTrackingSafe(game);
    } catch {
      if (message) message.textContent = "Ошибка\nВозврат на главную…";
      setTimeout(goHome, 2200);
    }
  }

  boot();
})();
