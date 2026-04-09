(function () {
  const $ = (id) => document.getElementById(id);

  const screens = {
    enter: $("screen-enter"),
    lobby: $("screen-lobby"),
    play: $("screen-play"),
    results: $("screen-results"),
  };

  function getClientId() {
    try {
      var k = "aeGameClientId";
      var id = sessionStorage.getItem(k);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "ae-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "ae-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelayMax: 10000,
  });

  var timerInterval = null;

  function clearTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function requestAeSync() {
    socket.emit("ae:requestSync");
  }

  function onConnected() {
    socket.emit("session:bind", { clientId: getClientId() });
    requestAeSync();
  }

  socket.on("connect", onConnected);
  socket.on("reconnect", onConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket.connected) requestAeSync();
  });

  function showScreen(name) {
    Object.keys(screens).forEach((k) => {
      screens[k].hidden = k !== name;
    });
  }

  function setError(el, msg) {
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function readName() {
    const el = $("input-name");
    const name = el.value.trim();
    if (!name) {
      setError($("enter-error"), "נא למלא שם");
      el.focus();
      return null;
    }
    return name;
  }

  function getTimeFromSelect(el) {
    return Number(el && el.value) || 0;
  }

  function buildPlayFields(categories, values) {
    const wrap = $("play-fields");
    wrap.innerHTML = "";
    (categories || []).forEach((cat) => {
      const v = (values && values[cat.key]) || "";
      const row = document.createElement("label");
      row.className = "ae-field";
      row.innerHTML =
        '<span class="ae-cat-label"></span><input type="text" class="ae-input" maxlength="40" autocomplete="off" />';
      row.querySelector(".ae-cat-label").textContent = cat.label;
      const inp = row.querySelector(".ae-input");
      inp.dataset.key = cat.key;
      inp.value = v;
      inp.dir = "rtl";
      wrap.appendChild(row);
    });
  }

  function collectAnswers() {
    const out = {};
    $("play-fields").querySelectorAll(".ae-input").forEach((inp) => {
      out[inp.dataset.key] = inp.value.trim();
    });
    return out;
  }

  function formatTick(deadline) {
    if (!deadline) return "";
    const sec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m > 0 ? m + ":" : "") + String(s).padStart(2, "0");
  }

  function startPlayTimer(deadline) {
    clearTimerInterval();
    const el = $("play-timer");
    if (!deadline) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    function tick() {
      el.textContent = "נשארו " + formatTick(deadline);
      if (Date.now() >= deadline) {
        clearTimerInterval();
        el.textContent = "הזמן נגמר";
      }
    }
    tick();
    timerInterval = setInterval(tick, 500);
  }

  function renderResults(room) {
    const letter = room.letter || "";
    $("results-letter-line").textContent = letter ? "האות בסיבוב: " + letter : "";

    const bd = room.lastBreakdown || {};
    const cats = room.categories || [];
    const players = room.players || [];

    var roundHtml = '<table class="score-table"><thead><tr><th>שחקן</th>';
    cats.forEach((c) => {
      roundHtml += "<th>" + escapeHtml(c.label) + "</th>";
    });
    roundHtml += "<th>סה״כ סיבוב</th></tr></thead><tbody>";
    players.forEach((p) => {
      const row = bd[p.id];
      roundHtml += "<tr><td>" + escapeHtml(p.name) + (p.isYou ? " (אתה)" : "") + "</td>";
      if (row && row.categories) {
        cats.forEach((c) => {
          roundHtml += "<td>" + (row.categories[c.key] != null ? row.categories[c.key] : "—") + "</td>";
        });
        roundHtml += "<td><strong>" + (row.roundTotal != null ? row.roundTotal : "0") + "</strong></td>";
      } else {
        cats.forEach(() => {
          roundHtml += "<td>—</td>";
        });
        roundHtml += "<td>—</td>";
      }
      roundHtml += "</tr>";
    });
    roundHtml += "</tbody></table>";
    $("results-round-table-wrap").innerHTML = roundHtml;

    const totals = room.totals || {};
    var totHtml = '<table class="score-table"><thead><tr><th>שחקן</th><th>סה״כ נקודות</th></tr></thead><tbody>';
    players.forEach((p) => {
      const t = totals[p.id] != null ? totals[p.id] : 0;
      totHtml += "<tr><td>" + escapeHtml(p.name) + "</td><td><strong>" + t + "</strong></td></tr>";
    });
    totHtml += "</tbody></table>";
    $("results-totals-wrap").innerHTML = totHtml;

    const hist = room.history || [];
    const histWrap = $("results-history-wrap");
    const histHead = $("history-heading");
    if (hist.length === 0) {
      histHead.hidden = true;
      histWrap.innerHTML = "";
    } else {
      histHead.hidden = false;
      var h = "";
      hist.forEach((entry) => {
        const letterH = entry.letter || "?";
        h += '<div class="history-block"><h3 class="history-letter">אות ' + escapeHtml(letterH) + "</h3>";
        h += '<table class="score-table compact"><thead><tr><th>שחקן</th><th>נקודות בסיבוב</th><th>סה״כ מצטבר אחרי</th></tr></thead><tbody>';
        players.forEach((p) => {
          const br = entry.breakdown && entry.breakdown[p.id];
          const roundPts = br && br.roundTotal != null ? br.roundTotal : "—";
          const after = entry.totalsAfter && entry.totalsAfter[p.id] != null ? entry.totalsAfter[p.id] : "—";
          h +=
            "<tr><td>" +
            escapeHtml(p.name) +
            "</td><td>" +
            roundPts +
            "</td><td>" +
            after +
            "</td></tr>";
        });
        h += "</tbody></table></div>";
      });
      histWrap.innerHTML = h;
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function applyRoom(room) {
    setError($("enter-error"), null);
    setError($("play-error"), null);

    if (!room) {
      clearTimerInterval();
      showScreen("enter");
      return;
    }

    const solo = !!room.solo;
    $("lobby-code-row").hidden = solo;
    $("lobby-hint-multi").hidden = solo;
    $("lobby-hint-solo").hidden = !solo;
    $("lobby-time-wrap").hidden = false;
    $("lobby-time-hint").hidden = room.isHost;

    if (room.phase === "lobby") {
      clearTimerInterval();
      showScreen("lobby");
      $("lobby-code").textContent = room.code;
      const list = $("lobby-players");
      list.innerHTML = "";
      room.players.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name + (p.isYou ? " (אתה)" : "") + (room.isHost && p.isYou ? " — מארח/ת" : "");
        if (p.isYou) li.classList.add("you");
        list.appendChild(li);
      });
      $("btn-start").disabled = !room.isHost;
      const tl = room.timeLimitSec != null ? room.timeLimitSec : 0;
      $("select-time-lobby").value = String(tl);
      $("select-time-lobby").disabled = !room.isHost;
      return;
    }

    if (room.phase === "playing") {
      showScreen("play");
      $("play-letter").textContent = room.letter || "—";
      const my = room.myAnswers || {};
      buildPlayFields(room.categories, my);
      const doneSelf = (room.players || []).find((p) => p.isYou && p.done);
      $("play-fields").querySelectorAll(".ae-input").forEach((inp) => {
        inp.disabled = !!doneSelf;
      });
      $("btn-done").disabled = !!doneSelf;
      const others = (room.players || []).filter((p) => !p.isYou);
      const allOthersDone = others.length === 0 || others.every((p) => p.done);
      if (doneSelf) {
        $("play-wait-status").textContent = allOthersDone ? "כולם סיימו — מחשבים…" : "מחכים לשאר השחקנים…";
      } else {
        $("play-wait-status").textContent = "";
      }
      startPlayTimer(room.roundDeadline);
      return;
    }

    if (room.phase === "results") {
      clearTimerInterval();
      showScreen("results");
      renderResults(room);
      $("btn-next-round").hidden = !room.isHost;
      return;
    }

    showScreen("enter");
  }

  socket.on("ae:update", (room) => {
    applyRoom(room);
  });

  socket.on("connect_error", () => {
    setError($("enter-error"), "לא ניתן להתחבר לשרת. ודאו שהשרת רץ.");
  });

  $("btn-create").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    const timeLimitSec = getTimeFromSelect($("select-time-enter"));
    socket.emit("ae:create", { name, clientId: getClientId(), timeLimitSec }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-solo").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    const timeLimitSec = getTimeFromSelect($("select-time-enter"));
    socket.emit("ae:createSolo", { name, clientId: getClientId(), timeLimitSec }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-join").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    const code = $("input-code").value.replace(/\D/g, "");
    if (code.length !== 6) {
      setError($("enter-error"), "הזינו קוד בן 6 ספרות");
      return;
    }
    socket.emit("ae:join", { name, code, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-lobby-back").addEventListener("click", () => {
    socket.emit("ae:leave", {}, (res) => {
      if (res && res.ok) applyRoom(null);
      else alert((res && res.error) || "לא ניתן לצאת");
    });
  });

  $("select-time-lobby").addEventListener("change", () => {
    if (!$("select-time-lobby").disabled) {
      socket.emit("ae:setTime", { seconds: Number($("select-time-lobby").value) });
    }
  });

  $("btn-start").addEventListener("click", () => {
    socket.emit("ae:start", {}, (res) => {
      if (res && !res.ok) setError($("enter-error"), res.error || "שגיאה");
    });
  });

  $("btn-done").addEventListener("click", () => {
    const answers = collectAnswers();
    socket.emit("ae:done", { answers }, (res) => {
      if (res && !res.ok) setError($("play-error"), res.error || "שגיאה");
    });
  });

  $("btn-next-round").addEventListener("click", () => {
    socket.emit("ae:nextRound", {}, (res) => {
      if (res && !res.ok) alert(res.error || "שגיאה");
    });
  });

  $("btn-results-home").addEventListener("click", () => {
    socket.emit("ae:leave", {}, () => {
      window.location.href = "/";
    });
  });

  $("btn-copy-code").addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    const url = `${window.location.origin}/aretz-ir/?room=${encodeURIComponent(code)}`;
    const btn = $("btn-copy-code");
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "הועתק!";
      setTimeout(() => {
        btn.textContent = "העתק קישור";
      }, 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "הועתק!";
        setTimeout(() => {
          btn.textContent = "העתק קישור";
        }, 2000);
      } catch {
        prompt("העתיקו את הקישור:", url);
      }
    }
  });

  $("link-home").addEventListener("click", (e) => {
    e.preventDefault();
    socket.emit("ae:leave", {}, () => {
      window.location.href = "/";
    });
  });

  const params = new URLSearchParams(window.location.search);
  const preRoom = params.get("room");
  if (preRoom) $("input-code").value = preRoom.replace(/\D/g, "").slice(0, 6);

  $("input-code").addEventListener("input", function (e) {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  });

  showScreen("enter");
})();
