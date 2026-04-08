const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3456;

const rooms = new Map();

function randomRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeRoomCode(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function normalizePlayerName(raw) {
  const t = String(raw || "").trim();
  if (!t) return { ok: false, error: "נא למלא שם" };
  if (t.length > 24) return { ok: false, error: "שם ארוך מדי" };
  return { ok: true, name: t };
}

function getLastWord(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  let w = parts[parts.length - 1] || "";
  w = w.replace(/^[\s"'״׳\(\[\{]+|[\s"'״׳\)\]\}\.,;:!?]+$/g, "");
  return w;
}

function createRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    solo: false,
    hostId: hostSocketId,
    players: [{ id: hostSocketId, name: hostName, clientId }],
    segments: [],
    turnIndex: 0,
    phase: "lobby",
    lastWord: null,
  };
  rooms.set(code, room);
  return room;
}

function createSoloRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (rooms.has(code));

  const botId = `bot:${code}`;
  const room = {
    code,
    solo: true,
    hostId: hostSocketId,
    players: [
      { id: hostSocketId, name: hostName, clientId },
      { id: botId, name: "בוט", clientId: "bot", isBot: true },
    ],
    segments: [],
    turnIndex: 0,
    phase: "lobby",
    lastWord: null,
  };
  rooms.set(code, room);
  return room;
}

function generateBotSentence(seed) {
  const s = (seed || "זה").trim();
  const lines = [
    `פתאום ראיתי את ${s} ולא האמנתי למה שקורה.`,
    `אמרתי לעצמי: אם ${s} כאן, אני עובר לצד השני של הרחוב.`,
    `הסיפור התחיל בדיוק כשהבנתי שמדובר ב${s}.`,
    `כל אחד דיבר על ${s} בלשון אחרת, אבל אף אחד לא הבין.`,
    `בגלל ${s} החלטתי לקחת הפסקה קצרה ולשתות קפה.`,
    `בלילה הזה ${s} נראה לי כמו סימן מהעתיד.`,
    `הדלת נפתחה ואז הופיע ${s} בלי להקדים מילה.`,
    `שאלתי את עצמי איך ${s} קשור לכל הסיפור הזה.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function scheduleBotTurn(io, roomCode) {
  const delay = 650 + Math.floor(Math.random() * 550);
  setTimeout(() => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== "playing") return;
    const len = room.players.length;
    const cur = room.players[room.turnIndex % len];
    if (!cur || !cur.isBot) return;
    const seed = room.lastWord || "";
    const text = generateBotSentence(seed);
    room.segments.push({ name: cur.name, text });
    room.lastWord = getLastWord(text);
    room.turnIndex = (room.turnIndex + 1) % len;
    broadcastRoom(io, room);
    const next = room.players[room.turnIndex % len];
    if (next && next.isBot) scheduleBotTurn(io, roomCode);
  }, delay);
}

function leaveRoom(socketId, io) {
  for (const [code, room] of rooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.solo) {
      rooms.delete(code);
      return;
    }
    if (room.hostId === socketId && room.players[0]) {
      room.hostId = room.players[0].id;
    }
    if (room.phase === "playing") {
      const len = room.players.length;
      if (len > 0) {
        room.turnIndex = room.turnIndex % len;
      }
    }
    broadcastRoom(io, room);
    return;
  }
}

function serializeRoom(room, forSocketId) {
  const isHost = room.hostId === forSocketId;
  const len = room.players.length;
  const isMyTurn =
    room.phase === "playing" &&
    len > 0 &&
    room.players[room.turnIndex % len]?.id === forSocketId;

  let visibleSeed = null;
  if (room.phase === "playing" && isMyTurn) {
    if (room.segments.length === 0) {
      visibleSeed = null;
    } else {
      visibleSeed = room.lastWord;
    }
  }

  const currentTurnName =
    room.phase === "playing" && len > 0 ? room.players[room.turnIndex % len]?.name || "" : "";

  return {
    code: room.code,
    solo: !!room.solo,
    phase: room.phase,
    players: room.players.map((p) => ({ name: p.name, isYou: p.id === forSocketId })),
    isHost,
    isMyTurn,
    currentTurnName,
    visibleSeed,
    isFirstSentence: room.segments.length === 0 && isMyTurn,
    storyLength: room.segments.length,
    fullStory:
      room.phase === "revealed"
        ? room.segments.map((s) => ({
            name: s.name,
            text: s.text,
          }))
        : null,
  };
}

/** שידור לכל מי שבחדר ה-socket (מסתמך על join ל-room.code), עם גיבוי ל-io.to */
function broadcastRoom(io, room) {
  const code = room.code;
  const allowed = new Set(room.players.map((p) => p.id));

  io.in(code)
    .fetchSockets()
    .then((socks) => {
      const got = new Set();
      for (const s of socks) {
        if (!allowed.has(s.id)) continue;
        s.emit("room:update", serializeRoom(room, s.id));
        got.add(s.id);
      }
      for (const p of room.players) {
        if (got.has(p.id)) continue;
        if (p.isBot) continue;
        io.to(p.id).emit("room:update", serializeRoom(room, p.id));
      }
    })
    .catch(() => {
      room.players.forEach((p) => {
        if (p.isBot) return;
        io.to(p.id).emit("room:update", serializeRoom(room, p.id));
      });
    });
}

function httpHandler(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, "public", path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, ""));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json",
      ".ico": "image/x-icon",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(httpHandler);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
  pingTimeout: 120000,
  pingInterval: 25000,
  connectTimeout: 45000,
  allowEIO3: false,
});

io.on("connection", (socket) => {
  socket.on("session:bind", (payload) => {
    const clientId = payload && payload.clientId;
    if (!clientId || typeof clientId !== "string") return;

    for (const room of rooms.values()) {
      const p = room.players.find((x) => x.clientId === clientId);
      if (!p) continue;

      p.id = socket.id;
      socket.data.roomCode = room.code;
      socket.data.clientId = clientId;
      socket.join(room.code);
      broadcastRoom(io, room);
      return;
    }
  });

  socket.on("room:create", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId =
      (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createRoom(socket.id, nv.name, clientId);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRoom(room, socket.id) });
    else socket.emit("room:update", serializeRoom(room, socket.id));
  });

  socket.on("room:createSolo", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId =
      (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createSoloRoom(socket.id, nv.name, clientId);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.clientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRoom(room, socket.id) });
    else socket.emit("room:update", serializeRoom(room, socket.id));
  });

  socket.on("room:join", (payload, cb) => {
    const code = normalizeRoomCode((payload && payload.code) || "");
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    if (code.length !== 6) {
      if (typeof cb === "function") cb({ ok: false, error: "הקוד הוא 6 ספרות" });
      return;
    }
    const clientId =
      (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    if (room.solo) {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן להצטרף — זה משחק מול בוט" });
      return;
    }
    room.players.push({ id: socket.id, name: nv.name, clientId });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.clientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRoom(room, socket.id) });
    broadcastRoom(io, room);
  });

  socket.on("room:leave", (payload, cb) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן לצאת מהחדר במהלך המשחק" });
      return;
    }
    leaveRoom(socket.id, io);
    socket.leave(code);
    delete socket.data.roomCode;
    socket.emit("room:update", null);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("room:requestSync", () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || !room.players.some((p) => p.id === socket.id)) return;
    socket.emit("room:update", serializeRoom(room, socket.id));
  });

  socket.on("room:start", (payload, cb) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח יכול להתחיל" });
      return;
    }
    if (room.players.length < 2) {
      if (typeof cb === "function") cb({ ok: false, error: "נדרשים לפחות שני שחקנים" });
      return;
    }
    room.phase = "playing";
    room.turnIndex = 0;
    room.segments = [];
    room.lastWord = null;
    broadcastRoom(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("game:submit", (payload, cb) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "אין משחק פעיל" });
      return;
    }
    const len = room.players.length;
    const current = room.players[room.turnIndex % len];
    if (!current || current.id !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "לא התור שלך" });
      return;
    }
    const text = String((payload && payload.text) || "").trim();
    if (!text) {
      if (typeof cb === "function") cb({ ok: false, error: "כתוב משפט" });
      return;
    }
    const endStory = !!(payload && payload.endStory);
    const name = current.name;
    room.segments.push({ name, text });
    room.lastWord = getLastWord(text);

    if (endStory) {
      room.phase = "revealed";
      broadcastRoom(io, room);
      if (typeof cb === "function") cb({ ok: true });
      return;
    }

    room.turnIndex = (room.turnIndex + 1) % len;
    broadcastRoom(io, room);
    if (typeof cb === "function") cb({ ok: true });
    const nextAfter = room.players[room.turnIndex % len];
    if (nextAfter && nextAfter.isBot) {
      scheduleBotTurn(io, code);
    }
  });

  socket.on("room:reset", (payload, cb) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח" });
      return;
    }
    room.phase = "lobby";
    room.segments = [];
    room.turnIndex = 0;
    room.lastWord = null;
    broadcastRoom(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (room && room.phase === "playing") {
      const sid = socket.id;
      setTimeout(() => {
        const r = rooms.get(code);
        if (!r) return;
        const stillThere = r.players.some((p) => p.id === sid);
        if (stillThere) leaveRoom(sid, io);
      }, 90000);
      return;
    }
    leaveRoom(socket.id, io);
  });
});

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`משחק המשפטים — listening on ${HOST}:${PORT}`);
});
