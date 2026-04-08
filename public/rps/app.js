(function () {
  const $ = (id) => document.getElementById(id);

  const CHOICE_META = {
    rock: { emoji: "🪨", label: "אבן" },
    paper: { emoji: "📄", label: "נייר" },
    scissors: { emoji: "✂️", label: "מספריים" },
  };

  const screens = {
    enter: $("screen-enter"),
    lobby: $("screen-lobby"),
    pick: $("screen-pick"),
    result: $("screen-result"),
  };

  function getClientId() {
    try {
      var k = "rpsGameClientId";
      var id = sessionStorage.getItem(k);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "rps-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "rps-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelayMax: 10000,
  });

  function requestRpsSync() {
    socket.emit("rps:requestSync");
  }

  function onConnected() {
    socket.emit("session:bind", { clientId: getClientId() });
    requestRpsSync();
  }

  socket.on("connect", onConnected);
  socket.on("reconnect", onConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket.connected) requestRpsSync();
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

  function buildPickButtons() {
    const wrap = $("rps-choices");
    wrap.innerHTML = "";
    ["rock", "paper", "scissors"].forEach((key) => {
      const m = CHOICE_META[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rps-choice";
      btn.dataset.choice = key;
      btn.innerHTML = '<span class="emoji" aria-hidden="true">' + m.emoji + "</span><span>" + m.label + "</span>";
      btn.addEventListener("click", () => {
        socket.emit("rps:pick", { choice: key }, (res) => {
          if (res && !res.ok) setError($("pick-error"), res.error || "שגיאה");
        });
      });
      wrap.appendChild(btn);
    });
  }

  buildPickButtons();

  function applyRps(room) {
    setError($("enter-error"), null);

    if (!room) {
      showScreen("enter");
      return;
    }

    if (room.phase === "lobby") {
      showScreen("lobby");
      const solo = !!room.solo;
      $("lobby-code-row").hidden = solo;
      $("lobby-hint-pvp").hidden = solo;
      $("lobby-hint-solo").hidden = !solo;
      $("lobby-code").textContent = room.code;
      const list = $("lobby-players");
      list.innerHTML = "";
      room.players.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name + (p.isYou ? " (אתה)" : "");
        if (p.isYou) li.classList.add("you");
        list.appendChild(li);
      });
      const startBtn = $("btn-start");
      startBtn.disabled = !(room.isHost && room.players.length >= 2);
      $("lobby-host-hint").hidden = !room.isHost || room.players.length >= 2;
      return;
    }

    if (room.phase === "pick") {
      showScreen("pick");
      setError($("pick-error"), null);
      const status = $("pick-status");
      if (room.myChoice) {
        const m = CHOICE_META[room.myChoice];
        if (room.waitingForOpponent) {
          status.textContent = "בחרת " + m.emoji + " " + m.label + " — מחכים ליריבה…";
        } else {
          status.textContent = "בחרת " + m.emoji + " " + m.label + ".";
        }
      } else if (room.rivalReady) {
        status.textContent = "היריבה כבר בחרה — התור שלך.";
      } else {
        status.textContent = "בחרו אבן, נייר או מספריים.";
      }

      const choices = $("rps-choices").querySelectorAll(".rps-choice");
      const locked = !!room.myChoice;
      choices.forEach((btn) => {
        btn.disabled = locked;
      });
      return;
    }

    if (room.phase === "result" && room.result) {
      showScreen("result");
      const r = room.result;
      $("result-banner").textContent = r.line || "";

      const row = $("picks-display");
      row.innerHTML = "";
      (r.picks || []).forEach((pick) => {
        const meta = CHOICE_META[pick.choice] || { emoji: "❓", label: pick.choice };
        const line = document.createElement("div");
        line.className = "pick-line";
        line.innerHTML =
          '<span class="who"></span><span class="combo" dir="ltr">' +
          meta.emoji +
          " " +
          meta.label +
          "</span>";
        line.querySelector(".who").textContent = pick.name + (pick.isBot ? " (בוט)" : "");
        row.appendChild(line);
      });
      return;
    }

    showScreen("enter");
  }

  socket.on("rps:update", (room) => {
    applyRps(room);
  });

  socket.on("connect_error", () => {
    setError($("enter-error"), "לא ניתן להתחבר לשרת. ודאו שהשרת רץ.");
  });

  $("btn-create").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("rps:create", { name, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRps(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-solo").addEventListener("click", () => {
    const name = readName();
    if (!name) return;
    socket.emit("rps:createSolo", { name, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRps(res.room);
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
    socket.emit("rps:join", { name, code, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRps(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-lobby-back").addEventListener("click", () => {
    socket.emit("rps:leave", {}, (res) => {
      if (res && res.ok) applyRps(null);
      else alert((res && res.error) || "לא ניתן לצאת מהחדר");
    });
  });

  $("btn-start").addEventListener("click", () => {
    socket.emit("rps:start", {}, (res) => {
      if (res && !res.ok) setError($("enter-error"), res.error || "שגיאה");
    });
  });

  $("btn-again").addEventListener("click", () => {
    socket.emit("rps:again", {}, (res) => {
      if (res && !res.ok) alert(res.error || "שגיאה");
    });
  });

  $("btn-home").addEventListener("click", () => {
    socket.emit("rps:leave", {}, (res) => {
      applyRps(null);
      window.location.href = "/";
    });
  });

  $("btn-copy").addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    const url = `${window.location.origin}/rps/?room=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      $("btn-copy").textContent = "הועתק!";
      setTimeout(() => {
        $("btn-copy").textContent = "העתק קישור";
      }, 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(code);
        $("btn-copy").textContent = "הועתק!";
        setTimeout(() => {
          $("btn-copy").textContent = "העתק קישור";
        }, 2000);
      } catch {
        prompt("העתיקו את הקישור:", url);
      }
    }
  });

  const params = new URLSearchParams(window.location.search);
  const preRoom = params.get("room");
  if (preRoom) $("input-code").value = preRoom.replace(/\D/g, "").slice(0, 6);

  $("input-code").addEventListener("input", function (e) {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  });

  showScreen("enter");
})();
