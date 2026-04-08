(function () {
  const $ = (id) => document.getElementById(id);

  const screens = {
    enter: $("screen-enter"),
    lobby: $("screen-lobby"),
    play: $("screen-play"),
    reveal: $("screen-reveal"),
  };

  function getClientId() {
    try {
      var k = "sentenceGameClientId";
      var id = sessionStorage.getItem(k);
      if (!id) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "sg-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "sg-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const socket = io({
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelayMax: 10000,
  });

  function requestRoomSync() {
    socket.emit("room:requestSync");
  }

  function onConnected() {
    socket.emit("session:bind", { clientId: getClientId() });
    requestRoomSync();
  }

  socket.on("connect", onConnected);
  socket.on("reconnect", onConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket.connected) requestRoomSync();
  });

  var prevWasMyTurnWhilePlaying = false;
  var audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function unlockAudioOnce() {
    try {
      var ctx = getAudioContext();
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) {}
  }
  document.body.addEventListener("click", unlockAudioOnce, { once: true, passive: true });
  document.body.addEventListener("touchstart", unlockAudioOnce, { once: true, passive: true });

  function playTurnBeep() {
    try {
      var ctx = getAudioContext();
      var start = function () {
        var t = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(660, t + 0.08);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      };
      if (ctx.state === "suspended") {
        ctx.resume().then(start);
      } else {
        start();
      }
    } catch (e) {}
  }

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

  function applyRoom(room) {
    setError($("enter-error"), null);
    setError($("play-error"), null);

    if (!room) {
      prevWasMyTurnWhilePlaying = false;
      showScreen("enter");
      return;
    }

    if (room.phase === "lobby") {
      prevWasMyTurnWhilePlaying = false;
      showScreen("lobby");
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
      $("lobby-hint-host").hidden = !room.isHost || room.players.length >= 2;
      return;
    }

    if (room.phase === "playing") {
      if (room.isMyTurn && !prevWasMyTurnWhilePlaying) {
        playTurnBeep();
      }
      prevWasMyTurnWhilePlaying = room.isMyTurn;

      showScreen("play");
      const turnName = room.currentTurnName || "";

      $("play-turn-info").textContent = room.isMyTurn
        ? "התור שלך לכתוב."
        : `עכשיו התור של ${turnName}.`;

      $("play-wait").hidden = room.isMyTurn;
      $("play-write").hidden = !room.isMyTurn;
      $("wait-name").textContent = turnName;

      if (room.isMyTurn) {
        $("play-first-hint").hidden = !room.isFirstSentence;
        $("seed-wrap").hidden = room.isFirstSentence;
        $("play-seed").textContent = room.visibleSeed || "";
      }
      return;
    }

    if (room.phase === "revealed") {
      prevWasMyTurnWhilePlaying = false;
      showScreen("reveal");
      const storyEl = $("reveal-story");
      storyEl.innerHTML = "";
      (room.fullStory || []).forEach((block) => {
        const div = document.createElement("div");
        div.className = "story-block";
        div.innerHTML = '<div class="by"></div><p class="text"></p>';
        div.querySelector(".by").textContent = block.name;
        div.querySelector(".text").textContent = block.text;
        storyEl.appendChild(div);
      });
      $("btn-new-game").disabled = !room.isHost;
      $("btn-new-game").style.display = room.isHost ? "" : "none";
      return;
    }

    prevWasMyTurnWhilePlaying = false;
    showScreen("enter");
  }

  socket.on("room:update", (room) => {
    applyRoom(room);
  });

  socket.on("connect_error", () => {
    setError($("enter-error"), "לא ניתן להתחבר לשרת. ודאו שהשרת רץ.");
  });

  $("btn-create").addEventListener("click", () => {
    const name = $("input-name").value.trim() || "שחקן";
    socket.emit("room:create", { name, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-join").addEventListener("click", () => {
    const name = $("input-name").value.trim() || "שחקן";
    const code = $("input-code").value.replace(/\D/g, "");
    if (code.length !== 6) {
      setError($("enter-error"), "הזינו קוד בן 6 ספרות");
      return;
    }
    socket.emit("room:join", { name, code, clientId: getClientId() }, (res) => {
      if (res && res.ok) applyRoom(res.room);
      else setError($("enter-error"), (res && res.error) || "שגיאה");
    });
  });

  $("btn-start").addEventListener("click", () => {
    socket.emit("room:start", {}, (res) => {
      if (res && !res.ok) setError($("enter-error"), res.error || "שגיאה");
    });
  });

  $("btn-submit-continue").addEventListener("click", () => {
    submitSentence(false);
  });

  $("btn-submit-end").addEventListener("click", () => {
    submitSentence(true);
  });

  function submitSentence(endStory) {
    const text = $("input-sentence").value.trim();
    socket.emit("game:submit", { text, endStory }, (res) => {
      if (res && res.ok) {
        $("input-sentence").value = "";
        setError($("play-error"), null);
      } else setError($("play-error"), (res && res.error) || "שגיאה");
    });
  }

  $("btn-new-game").addEventListener("click", () => {
    socket.emit("room:reset", {}, (res) => {
      if (res && !res.ok) alert(res.error || "שגיאה");
    });
  });

  $("btn-copy-code").addEventListener("click", async () => {
    const code = $("lobby-code").textContent;
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      $("btn-copy-code").textContent = "הועתק!";
      setTimeout(() => {
        $("btn-copy-code").textContent = "העתק קישור";
      }, 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(code);
        $("btn-copy-code").textContent = "הועתק!";
        setTimeout(() => {
          $("btn-copy-code").textContent = "העתק קישור";
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
