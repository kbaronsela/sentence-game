(function () {
  const $ = (id) => document.getElementById(id);

  const COLOR_NAMES = { R: "אדום", Y: "צהוב", B: "כחול", G: "ירוק" };

  const screens = {
    enter: $("screen-enter"),
    lobby: $("screen-lobby"),
    game: $("screen-game"),
    result: $("screen-result"),
  };

  function getClientId() {
    try {
      var k = "takiGameClientId";
      var id = sessionStorage.getItem(k);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "taki-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "taki-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelayMax: 10000,
  });

  function requestTakiSync() {
    socket.emit("taki:requestSync");
  }

  function onConnected() {
    socket.emit("session:bind", { clientId: getClientId() });
    requestTakiSync();
  }

  socket.on("connect", onConnected);
  socket.on("reconnect", onConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket.connected) requestTakiSync();
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

  function cardClass(color) {
    if (color === "R") return "c-red";
    if (color === "Y") return "c-yellow";
    if (color === "B") return "c-blue";
    if (color === "G") return "c-green";
    return "c-wild";
  }

  function renderCardFace(card, small) {
    const el = document.createElement("div");
    el.className = "taki-card-face " + cardClass(card.color) + (small ? " small" : "");
    if (card.type === "num") {
      el.textContent = String(card.value);
    } else if (card.type === "plus2") {
      el.textContent = "+2";
    } else if (card.type === "stop") {
      el.textContent = "עצור";
    } else if (card.type === "reverse") {
      el.textContent = "הפוך";
    } else if (card.type === "taki") {
      el.textContent = "טאקי";
    } else if (card.type === "change") {
      el.textContent = card.color ? "צבע" : "שינוי";
      if (card.color) {
        el.textContent = COLOR_NAMES[card.color] || "";
      }
    }
    return el;
  }

  function renderDiscard(slot, top) {
    slot.innerHTML = "";
    if (!top) return;
    const wrap = document.createElement("div");
    wrap.className = "taki-card taki-card-static";
    wrap.appendChild(renderCardFace(top, true));
    slot.appendChild(wrap);
  }

  function renderHand(wrap, hand, enabled, onPlay) {
    wrap.innerHTML = "";
    (hand || []).forEach((card) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "taki-card";
      btn.appendChild(renderCardFace(card, false));
      btn.disabled = !enabled;
      btn.addEventListener("click", () => onPlay(card.id));
      wrap.appendChild(btn);
    });
  }

  function applyRoom(room) {
    setError($("enter-error"), null);
    setError($("game-error"), null);

    if (!room) {
      showScreen("enter");
      return;
    }

    const solo = !!room.solo;
    $("lobby-hint-solo").hidden = !solo;
    $("lobby-hint-multi").hidden = solo;
    $("lobby-code-row").hidden = false;

    if (room.phase === "lobby") {
      showScreen("lobby");
      $("lobby-code").textContent = room.code;
      const list = $("lobby-players");
      list.innerHTML = "";
      room.players.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name + (p.isYou ? " (אתה)" : "") + " — " + (p.score || 0) + " נק׳";
        if (p.isYou) li.classList.add("you");
        list.appendChild(li);
      });
      const n = room.players.length;
      let canStart = room.isHost;
      if (solo) {
        canStart = canStart && n === 4;
      } else {
        canStart = canStart && n >= 2 && n <= 4;
      }
      $("btn-start").disabled = !canStart;
      $("lobby-host-hint").hidden = !room.isHost || canStart;
      return;
    }

    if (room.phase === "playing") {
      showScreen("game");
      $("deck-count").textContent = String(room.deckCount != null ? room.deckCount : 0);
      renderDiscard($("discard-slot"), room.topCard);

      const scoresEl = $("taki-scores");
      scoresEl.innerHTML = "";
      room.players.forEach((p) => {
        const row = document.createElement("div");
        row.className = "taki-score-row" + (p.isYou ? " you" : "");
        row.textContent = p.name + (p.isBot ? " (בוט)" : "") + ": " + (p.score || 0) + " נק׳ · " + (p.handCount || 0) + " קלפים";
        scoresEl.appendChild(row);
      });

      let status = "";
      if (room.mustPickColor) {
        status = "בחרו צבע לקלף ״שינוי צבע״.";
      } else if (room.isMyTurn) {
        status = room.inTakiChain ? "מצב טאקי — הניחו קלפים בצבע או לחצו ״סיימתי״." : "התור שלך.";
      } else {
        status = "התור של " + (room.currentTurnName || "…") + ".";
      }
      if (room.plus2Stack > 0) {
        $("plus2-hint").hidden = false;
        $("plus2-hint").textContent = "מצטבר +2: " + room.plus2Stack + " — הניחו +2 או קחו קלפים.";
      } else {
        $("plus2-hint").hidden = true;
      }

      $("game-status").textContent = status;

      $("color-pick").hidden = !room.mustPickColor;
      $("btn-taki-done").hidden = !(room.inTakiChain && room.isMyTurn);

      const canPlayHand = room.isMyTurn && !room.mustPickColor;
      renderHand($("taki-hand"), room.myHand, canPlayHand, (id) => {
        socket.emit("taki:play", { cardId: id }, (res) => {
          if (res && !res.ok) setError($("game-error"), res.error || "שגיאה");
        });
      });

      $("btn-draw").disabled = !room.isMyTurn || room.mustPickColor;
      return;
    }

    if (room.phase === "result" && room.result) {
      showScreen("result");
      const r = room.result;
      $("result-banner").textContent = (r.winnerName || "מישהו") + " ניצח/ה את הסיבוב! (+" + (r.roundPoints || 0) + " נק׳)";
      const box = $("result-scores");
      box.innerHTML = "";
      (r.scores || []).forEach((s) => {
        const line = document.createElement("div");
        line.className = "result-score-line";
        line.textContent = s.name + (s.isBot ? " (בוט)" : "") + ": " + (s.score || 0) + " נקודות";
        box.appendChild(line);
      });
      $("btn-again").hidden = !room.isHost;
      return;
    }

    showScreen("enter");
  }

  socket.on("taki:update", (room) => {
    applyRoom(room);
  });

  socket.on("connect_error", () => {
    setError($("enter-error"), "לא ניתן להתחבר לשרת. ודאו שהשרת רץ.");
  });

  $("btn-create").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("taki:create", { name, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-solo").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("taki:createSolo", { name, clientId: getClientId() }, (res) => {
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
    socket.emit("taki:join", { name, code, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-lobby-back").addEventListener("click", () => {
    socket.emit("taki:leave", {}, (res) => {
      if (res && res.ok) applyRoom(null);
      else alert((res && res.error) || "לא ניתן לצאת");
    });
  });

  $("btn-start").addEventListener("click", () => {
    socket.emit("taki:start", {}, (res) => {
      if (res && !res.ok) setError($("enter-error"), res.error || "שגיאה");
    });
  });

  $("btn-draw").addEventListener("click", () => {
    socket.emit("taki:draw", {}, (res) => {
      if (res && !res.ok) setError($("game-error"), res.error || "שגיאה");
    });
  });

  $("btn-taki-done").addEventListener("click", () => {
    socket.emit("taki:takiDone", {}, (res) => {
      if (res && !res.ok) setError($("game-error"), res.error || "שגיאה");
    });
  });

  document.querySelectorAll(".taki-color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.getAttribute("data-color");
      socket.emit("taki:pickColor", { color }, (res) => {
        if (res && !res.ok) setError($("game-error"), res.error || "שגיאה");
      });
    });
  });

  $("btn-again").addEventListener("click", () => {
    socket.emit("taki:again", {}, (res) => {
      if (res && !res.ok) alert(res.error || "שגיאה");
    });
  });

  $("btn-home").addEventListener("click", () => {
    socket.emit("taki:leave", {}, () => {
      window.location.href = "/";
    });
  });

  $("btn-copy-code").addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    const url = `${window.location.origin}/taki/?room=${encodeURIComponent(code)}`;
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
    socket.emit("taki:leave", {}, () => {
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
