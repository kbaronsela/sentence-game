const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3456;

const rooms = new Map();

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getLastWord(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  let w = parts[parts.length - 1] || "";
  w = w.replace(/^[\s"'״׳\(\[\{]+|[\s"'״׳\)\]\}\.,;:!?]+$/g, "");
  return w;
}

function createRoom(hostSocketId, hostName) {
  let code;
  do {
    code = randomRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    hostId: hostSocketId,
    players: [{ id: hostSocketId, name: hostName.trim() || "שחקן" }],
    segments: [],
    turnIndex: 0,
    phase: "lobby",
    lastWord: null,
  };
  rooms.set(code, room);
  return room;
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
    room.phase === "playing" && len > 0
      ? room.players[room.turnIndex % len]?.name || ""
      : "";

  return {
    code: room.code,
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
});

/** שליחת מצב מותאם אישית לכל שחקן מחובר (אמין יותר מ-io.to(id) בפרודקשן) */
function broadcastRoom(io, room) {
  room.players.forEach((p) => {
    const sock = io.sockets.sockets.get(p.id);
    if (sock && sock.connected) {
      sock.emit("room:update", serializeRoom(room, p.id));
    }
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload, cb) => {
    const name = (payload && payload.name) || "שחקן";
    const room = createRoom(socket.id, name);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    if (typeof cb === "function") cb({ ok: true, room: serializeRoom(room, socket.id) });
    else socket.emit("room:update", serializeRoom(room, socket.id));
  });

  socket.on("room:join", (payload, cb) => {
    const code = String((payload && payload.code) || "")
      .trim()
      .toUpperCase();
    const name = (payload && payload.name) || "שחקן";
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    room.players.push({ id: socket.id, name: name.trim() || "שחקן" });
    socket.join(code);
    socket.data.roomCode = code;
    if (typeof cb === "function") cb({ ok: true, room: serializeRoom(room, socket.id) });
    broadcastRoom(io, room);
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
    leaveRoom(socket.id, io);
  });
});

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`משחק המשפטים — listening on ${HOST}:${PORT}`);
});
