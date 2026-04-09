(function () {
  const $ = (id) => document.getElementById(id);

  function winWord(n) {
    return n === 1 ? "ניצחון" : "ניצחונות";
  }

  const screens = {
    enter: $("screen-enter"),
    lobby: $("screen-lobby"),
    game: $("screen-game"),
    result: $("screen-result"),
  };

  function getClientId() {
    try {
      var k = "xoGameClientId";
      var id = sessionStorage.getItem(k);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "xo-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "xo-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelayMax: 10000,
  });

  function requestXoSync() {
    socket.emit("xo:requestSync");
  }

  function onConnected() {
    socket.emit("session:bind", { clientId: getClientId() });
    requestXoSync();
  }

  socket.on("connect", onConnected);
  socket.on("reconnect", onConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket.connected) requestXoSync();
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

  function symLabel(s) {
    if (s === "X") return "איקס (X)";
    if (s === "O") return "עיגול (O)";
    return "";
  }

  function buildBoard(wrapId, board, interactive, isMyTurn, onCell) {
    const wrap = $(wrapId);
    wrap.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "xo-cell";
      btn.dataset.index = String(i);
      const v = board && board[i];
      if (v) {
        btn.textContent = v;
        btn.disabled = true;
        btn.classList.add("taken", v === "X" ? "x-mark" : "o-mark");
      } else {
        btn.textContent = "";
        btn.disabled = !interactive || !isMyTurn;
      }
      if (interactive && !v) {
        btn.addEventListener("click", () => onCell(i));
      }
      wrap.appendChild(btn);
    }
  }

  function applyRoom(room) {
    setError($("enter-error"), null);
    setError($("game-error"), null);

    if (!room) {
      showScreen("enter");
      return;
    }

    const solo = !!room.solo;
    $("lobby-code-row").hidden = solo;
    $("lobby-hint-multi").hidden = solo;
    $("lobby-hint-solo").hidden = !solo;

    if (room.phase === "lobby") {
      showScreen("lobby");
      $("lobby-code").textContent = room.code;
      const list = $("lobby-players");
      list.innerHTML = "";
      room.players.forEach((p) => {
        const li = document.createElement("li");
        var line = p.name + (p.isYou ? " (אתה)" : "");
        if (p.symbol) line += " — " + symLabel(p.symbol);
        li.textContent = line;
        if (p.isYou) li.classList.add("you");
        list.appendChild(li);
      });
      const canStart = room.isHost && (solo || room.players.length >= 2);
      $("btn-start").disabled = !canStart;
      $("lobby-host-hint").hidden = !room.isHost || canStart;
      return;
    }

    if (room.phase === "playing") {
      showScreen("game");
      const mySym = room.mySymbol;
      var status = "";
      if (room.isMyTurn) {
        status = "התור שלך — " + symLabel(mySym) + ".";
      } else {
        const other = (room.players || []).find((p) => !p.isYou);
        status = other ? "התור של " + other.name + " (" + symLabel(other.symbol) + ")." : "מחכים…";
      }
      $("game-status").textContent = status;
      buildBoard(
        "xo-board",
        room.board,
        true,
        room.isMyTurn,
        (idx) => {
          socket.emit("xo:move", { index: idx }, (res) => {
            if (res && !res.ok) setError($("game-error"), res.error || "שגיאה");
          });
        }
      );
      return;
    }

    if (room.phase === "result" && room.result) {
      showScreen("result");
      const r = room.result;
      $("result-banner").textContent = r.line || "";
      buildBoard("result-board", r.board, false, false, function () {});
      const scoresEl = $("result-scores");
      scoresEl.innerHTML = "";
      const scores = r.scores;
      if (scores && scores.length) {
        const title = document.createElement("p");
        title.className = "result-scores-title";
        title.textContent = "ניצחונות";
        scoresEl.appendChild(title);
        scores.forEach((s) => {
          const lineEl = document.createElement("div");
          lineEl.className = "result-score-line";
          const label = s.name + (s.isBot ? " (בוט)" : "");
          lineEl.textContent = label + ": " + s.wins + " " + winWord(s.wins);
          scoresEl.appendChild(lineEl);
        });
      }
      $("btn-again").hidden = !room.isHost;
      return;
    }

    showScreen("enter");
  }

  socket.on("xo:update", (room) => {
    applyRoom(room);
  });

  socket.on("connect_error", () => {
    setError($("enter-error"), "לא ניתן להתחבר לשרת. ודאו שהשרת רץ.");
  });

  $("btn-create").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("xo:create", { name, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-solo").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("xo:createSolo", { name, clientId: getClientId() }, (res) => {
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
    socket.emit("xo:join", { name, code, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-lobby-back").addEventListener("click", () => {
    socket.emit("xo:leave", {}, (res) => {
      if (res && res.ok) applyRoom(null);
      else alert((res && res.error) || "לא ניתן לצאת");
    });
  });

  $("btn-start").addEventListener("click", () => {
    socket.emit("xo:start", {}, (res) => {
      if (res && !res.ok) setError($("enter-error"), res.error || "שגיאה");
    });
  });

  $("btn-again").addEventListener("click", () => {
    socket.emit("xo:again", {}, (res) => {
      if (res && !res.ok) alert(res.error || "שגיאה");
    });
  });

  $("btn-home").addEventListener("click", () => {
    socket.emit("xo:leave", {}, () => {
      window.location.href = "/";
    });
  });

  $("btn-copy-code").addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    const url = `${window.location.origin}/xo/?room=${encodeURIComponent(code)}`;
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
    socket.emit("xo:leave", {}, () => {
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
