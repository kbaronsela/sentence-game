const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3456;

const rooms = new Map();

/** טיימר הסרה אחרי ניתוק — מבוטל ב-session:bind כשחוזרים עם אותו clientId (רענון דף) */
const pendingLeave = new Map();

function cancelPendingLeave(socketId) {
  const t = pendingLeave.get(socketId);
  if (t) {
    clearTimeout(t);
    pendingLeave.delete(socketId);
  }
}

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
    `לא ידעתי אם לצחוק או להיבהל כששמעתי את השם ${s}.`,
    `מישהו לחש לי באוזן: תזכור את ${s}, זה חשוב.`,
    `במקרה פתחתי את המגירה ומצאתי שם תזכורת ישנה על ${s}.`,
    `הרוח נשבה חזק, ואז ${s} נזכר שוב בכל השיחות.`,
    `אמא תמיד אמרה שאין להתעלם מ${s} כשמופיע בדרך.`,
    `בחלום ראיתי את ${s} צף מעל הבית, בלי הסבר.`,
    `המורה כתבה על הלוח מילה אחת: ${s}, וכולם שתקו.`,
    `הקפה התקרר בזמן שחשבתי מה ${s} באמת אומר לי.`,
    `באוטובוס ישבתי ליד מישהו שדיבר רק על ${s}.`,
    `פתאום הטלפון צלצל, והמסך הציג את המילה ${s}.`,
    `הילדים רצו לחצר וצעקו: תראו, ${s}!`,
    `ספרתי עד עשר, נשמתי עמוק, ואז חזרתי ל${s}.`,
    `השכן מלמעלה הוריד מוזיקה חזקה, ועדיין שמעתי את ${s}.`,
    `במפת הדרכים סומן במדויק המקום שבו נפגשנו ב${s}.`,
    `העיתון כתב משהו קטן על ${s}, וזה הספיק כדי לשנות יום.`,
    `אף אחד לא האמין שאפשר לשכוח את ${s}, אבל ניסינו.`,
    `השמש ירדה, והצללים נראו כמו צורה של ${s}.`,
    `במעלית היה ריח של גשם וזיכרון ישן של ${s}.`,
    `הקלטתי לעצמי הודעה: אל תשכחי את ${s} למחרת בבוקר.`,
    `הספר נסגר בקול חד, כאילו ${s} היה הסוף של הפרק.`,
    `במסעדה השירות היה איטי, אז חשבתי שוב על ${s}.`,
    `הכלב הריח משהו, רץ לכיוון ${s} ולא חזר מהר.`,
    `השעון הראה חצות, ודיוק לשעה נזכרתי ב${s}.`,
    `מישהו שלח לי תמונה מטושטשת, ובקושי זיהיתי את ${s}.`,
    `המזגן נדלק לבד, וזה הרגיש כמו רמז על ${s}.`,
    `בשקט של הבית שמעתי רק את המילה ${s} חוזרת בראש.`,
    `המפה הראתה דרך ארוכה, ובסופה כתוב רק ${s}.`,
    `חבר ישן התעורר ואמר פתאום: רגע, מה עם ${s}?`,
    `המדריך עצר את הקבוצה ואמר: כאן התחיל ${s}.`,
    `במייל הגיע נושא ריק, ובגוף המכתב מילה אחת: ${s}.`,
    `הילד צייר עיגול, בתוכו כתב בקושי את ${s}.`,
    `השלג נמס, והמילה ${s} נשארה על החלון.`,
    `בתור חיכיתי שעה, וכל הזמן חזרתי אל ${s}.`,
    `הרופא אמר שזה יעבור, אבל לא הסביר מה זה ${s}.`,
    `בחנות נעלמו כל המוצרים חוץ מכרטיס קטן עם ${s}.`,
    `הסבא חייך ואמר: בימיי קראו לזה ${s}.`,
    `הרדיו שידר שקט, ואז קול אחד אמר ${s} והסתיים.`,
    `בשביל העפר היה רך, כאילו ${s} מחכה שם מזמן.`,
    `המטרה הייתה ברורה: להגיע ל${s} לפני בוקר.`,
    `איש לא ידע מי כתב על הקיר את המילה ${s}.`,
    `הסרט הסתיים בפתאומיות, והמסך נשאר עם ${s}.`,
    `במעלית האחרונה ירדתי בקומה הלא נכונה בגלל ${s}.`,
    `הקיץ היה חם, והשמיים נראו כמו רקע ל${s}.`,
    `מישהו השאיר מפתח תחת השטיח, ועליו חרוט ${s}.`,
    `השכיחות שלי גרמה לי לשכוח הכל חוץ מ${s}.`,
    `במסיבה המוזיקה נעצרה, ואז כולם שרו ${s} ביחד.`,
    `הספרים זזו לבד על המדף כשהוזכר ${s}.`,
    `הגשם הכה בחלון, וכל טיפה נשמעה כמו הברה מ${s}.`,
    `בדרך חזרה איבדתי את המפתח, אבל מצאתי את ${s}.`,
    `השעון המעורר נשבר, אבל המוח התעורר על ${s}.`,
    `מישהו צייץ ברשת משהו מוזר על ${s}, וזה הפך לוויראלי.`,
    `המדרון היה תלול, ובתחתית מישהו צעק: ${s}!`,
    `השקט בחדר היה כבד, עד שמישהו אמר בקול ${s}.`,
    `במזוודה מצאתי מכתב ישן שמתחיל ונגמר ב${s}.`,
    `הכוכבים יצאו, ואחד מהם נראה כמו ${s} מרחוק.`,
    `המזג האוויר אמר "בהיר", אבל בלב הרגשתי ${s}.`,
    `במסעדת דרכים היה תפריט קצר, ובו רק תבנית של ${s}.`,
    `הילד שאל למה השמיים כחולים, ועניתי משהו על ${s}.`,
    `המפתח התעקם בחור, כאילו ${s} לא רצה שנכנס.`,
    `בחלום השני אותו אדם חזר, הפעם בלי להזכיר את ${s}.`,
    `השכנה תלתה כביסה, ועל גג הגג רוח ${s}.`,
    `המסלול התפתל בין עצים, ובכל פנייה חשבתי על ${s}.`,
    `מישהו השאיר אופניים, ועל המנעול הדביק מדבקה: ${s}.`,
    `הקפה נשפך על השולחן, והכתמים נראו כמו ${s}.`,
    `בתחנת הרדיו שמעתי שיר ישן שמזכיר את ${s}.`,
    `המדרגות נשברו בקומה האחרונה, ושם כתוב ${s}.`,
    `השעון בכנסייה תקין, אבל הפעמון הכה בשם ${s}.`,
    `במעבדה הכל היה נקי מדי, חוץ מפתק אחד: ${s}.`,
    `הסופה עברה, ובחצר נשאר רק סימן של ${s}.`,
    `מישהו צילם את השמיים והוסיף כיתוב: תודה ל${s}.`,
    `הספר נפל מהמדף, ונפתח בדיוק על העמוד של ${s}.`,
    `במקלחת הזכרתי פתאום שכחתי משהו חשוב על ${s}.`,
    `הדובר איבד את המילים, ואז אמר רק ${s} והתיישב.`,
    `בשביל החצץ הבריק, וכל אבן נראית כמו חלק מ${s}.`,
    `המונית עצרה פתאום, והנהג אמר: ירדתם ב${s}.`,
    `בליל קיץ שמעתי צרצרים, וזה נשמע כמו שיר על ${s}.`,
    `המזוודה הייתה קלה מדי, כאילו ${s} נשאר בבית.`,
    `מישהו צייר על החול עיגול וכתב בתוכו ${s}.`,
    `הרוח סגרה את החלון, ואיתה נסגר גם הנושא ${s}.`,
    `במסיבת יום הולדת כיבו את האורות על שם ${s}.`,
    `המדריך איבד את הקבוצה, אבל לא את המילה ${s}.`,
    `במעלית כתוב "לא לשבת", ומישהו הוסיף ביד: ${s}.`,
    `השעון בטלפון קפא, והמסך הציג רק את ${s}.`,
    `בגן היה שלט "אסור לדלג", ומישהו כתב מתחת: ${s}.`,
    `הסיר רתח על האש, ומריח התבלינים נזכרתי ב${s}.`,
    `מישהו השאיר פרחים ליד הדלת, ועל הכרטיס רק ${s}.`,
    `הסרטון נגמר, והמלל האחרון היה בדיוק ${s}.`,
    `בשביל החזרה היה חשוך, וכל פנס הדליק זיכרון של ${s}.`,
    `המורה ביקשה נושא לחיבור, ומישהו קרא בקול: ${s}!`,
    `המפתח נתקע בדלת, כאילו ${s} לא רוצה שניכנס הביתה.`,
    `בשמיים הופיע ענן מוזר, וכולם קראו לו ${s}.`,
    `המכתב הגיע בלי חותמת, רק עם המילה ${s} בפנים.`,
    `במסעדה הזמינו לי מנה, ועל הצלחת היה רושם של ${s}.`,
    `השעון המעורר שינה צליל, ועכשיו הוא מצפצף את ${s}.`,
    `מישהו ניפח בלון וכתב עליו בטוש את ${s}.`,
    `הדרך חזרה הייתה ארוכה, אבל ${s} ליווה אותי בראש.`,
    `בחוף הים מצאתי בקבוק עם פתק קטן: זוכרים את ${s}?`,
    `המזגן נשבר, והחום גרם לי לחלום על ${s}.`,
    `במעלית היה ריח של צבע רטוב, ועל הקיר נשרטט ${s}.`,
    `השכן ניגן בגיטרה שיר עצוב על ${s}.`,
    `במסעדה הזמינו לי מרק, ובתוכו צף משהו שנראה כמו ${s}.`,
    `הספר נפל מהיד, ונפתח על משפט שמתחיל ב${s}.`,
    `מישהו צילם את הירח, והוסיף כיתוב: שלום ל${s}.`,
    `המדריך אמר שנעצור כאן, כי מעבר לזה מתחיל ${s}.`,
    `בשקט של הלילה שמעתי דפיקה, ואז קול אמר ${s}.`,
    `המפתחות נעלמו, ורק מפתח אחד נשאר עם התווית ${s}.`,
    `במסיבה כיבו את האור, ומישהו לחש את המילה ${s}.`,
    `השביל התפצל לשניים, ועל הסימון רק ${s}.`,
    `המורה ביקשה שקט, ואז קראה בקול את ${s}.`,
    `בחלום ראיתי עיר שלמה שקוראים לה ${s}.`,
    `המזגן שחרר קרירות, ופתאום הרגשתי קרוב ל${s}.`,
    `מישהו השאיר תיק, ובתוכו מחברת ריקה חוץ משורה אחת: ${s}.`,
    `השעון דפק שלוש, ודיוק אז נזכרתי למה חשוב ${s}.`,
    `במעלית היה מראה, ובשקופית כתוב: מי זה ${s}?`,
    `הסופה כיבתה את החשמל, ונשארנו רק עם ${s} בזיכרון.`,
    `בשביל העפר הופיעו עקבות, ולידן כתוב ${s}.`,
    `המדריך אמר שזה המקום האחרון לפני ${s}.`,
    `מישהו שלח לי גלויה בלי כתובת, רק עם ${s} בצד.`,
    `השמש עלתה, והצל הראשון נראה כמו ${s}.`,
    `במסעדה השירות היה מהיר, אבל המנה באה עם טעם של ${s}.`,
    `הספר נשאר פתוח על השולחן, והעמוד הראשי אמר ${s}.`,
    `במעלית היה כפתור שלא עבד, ומעליו מדבקה: ${s}.`,
    `הילד ביקש סיפור לפני השינה, ואז הזכרתי את ${s}.`,
    `הרוח סגרה את הדלת, ופתחה בי שאלה על ${s}.`,
    `במסיבה כולם רקדו, חוץ ממי שחשב על ${s}.`,
    `המפתח נשבר במנעול, ומישהו צחק: זה בגלל ${s}.`,
    `השמיים נצבעו באדום, ומישהו לחש: זה סימן ל${s}.`,
    `במסעדה הזמינו לי מנה מיוחדת בשם ${s}.`,
    `המדרגות הובילו למרתף, ושם על הקיר רק ${s}.`,
    `מישהו השאיר אופניים, והמנעול היה עם הקוד ${s}.`,
    `השעון הראה ארבע, ודיוק אז נגמר הסיפור על ${s}.`,
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
const rpsRooms = new Map();
const pendingRpsLeave = new Map();

function cancelPendingRpsLeave(socketId) {
  const t = pendingRpsLeave.get(socketId);
  if (t) {
    clearTimeout(t);
    pendingRpsLeave.delete(socketId);
  }
}

function rpsRoomName(code) {
  return `rps:${code}`;
}

function rpsWinner(a, b) {
  if (a === b) return "tie";
  const beats = { rock: "scissors", scissors: "paper", paper: "rock" };
  if (beats[a] === b) return "a";
  return "b";
}

function createRpsRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (rpsRooms.has(code));

  const room = {
    code,
    solo: false,
    hostId: hostSocketId,
    mode: "pvp",
    phase: "lobby",
    players: [{ id: hostSocketId, name: hostName, clientId, choice: null, wins: 0 }],
    lastResult: null,
  };
  rpsRooms.set(code, room);
  return room;
}

function createRpsSoloRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (rpsRooms.has(code));

  const botId = `rpsbot:${code}`;
  const room = {
    code,
    solo: true,
    hostId: hostSocketId,
    mode: "bot",
    phase: "lobby",
    players: [
      { id: hostSocketId, name: hostName, clientId, choice: null, wins: 0 },
      { id: botId, name: "בוט", clientId: "rps-bot", isBot: true, choice: null, wins: 0 },
    ],
    lastResult: null,
  };
  rpsRooms.set(code, room);
  return room;
}

function leaveRpsRoom(socketId, io) {
  for (const [code, room] of rpsRooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);
    if (room.players.length === 0 || room.solo) {
      rpsRooms.delete(code);
      return;
    }
    if (room.hostId === socketId && room.players[0]) {
      room.hostId = room.players[0].id;
    }
    broadcastRps(io, room);
    return;
  }
}

function resolveRpsRound(room) {
  const [p0, p1] = room.players;
  const c0 = p0.choice;
  const c1 = p1.choice;
  if (!c0 || !c1) return;
  const w = rpsWinner(c0, c1);
  let winnerName = null;
  let tie = false;
  if (w === "tie") {
    tie = true;
  } else if (w === "a") {
    winnerName = p0.name;
    p0.wins = (p0.wins || 0) + 1;
  } else {
    winnerName = p1.name;
    p1.wins = (p1.wins || 0) + 1;
  }
  room.phase = "result";
  room.lastResult = {
    tie,
    winnerName,
    line: tie ? "תיקו!" : `${winnerName} מנצח/ת!`,
    picks: [
      { name: p0.name, choice: c0, isBot: !!p0.isBot },
      { name: p1.name, choice: c1, isBot: !!p1.isBot },
    ],
    scores: room.players.map((p) => ({
      name: p.name,
      wins: p.wins || 0,
      isBot: !!p.isBot,
    })),
  };
}

function serializeRpsRoom(room, forSocketId) {
  const me = room.players.find((p) => p.id === forSocketId);
  const isHost = room.hostId === forSocketId;
  const opponent = room.players.find((p) => p.id !== forSocketId);

  if (room.phase === "result" && room.lastResult) {
    return {
      code: room.code,
      phase: room.phase,
      mode: room.mode,
      solo: !!room.solo,
      players: room.players.map((p) => ({
        name: p.name,
        isYou: p.id === forSocketId,
        isBot: !!p.isBot,
      })),
      isHost,
      myChoice: null,
      opponentPicked: true,
      waitingForOpponent: false,
      rivalReady: false,
      result: room.lastResult,
    };
  }

  const myChoice = me ? me.choice : null;
  const oppPicked = !!(opponent && opponent.choice);
  const waitingForOpponent =
    room.phase === "pick" && me && me.choice && opponent && !opponent.choice && room.mode === "pvp";
  const rivalReady =
    room.phase === "pick" && me && !me.choice && opponent && opponent.choice && room.mode === "pvp";

  return {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    solo: !!room.solo,
    players: room.players.map((p) => ({
      name: p.name,
      isYou: p.id === forSocketId,
      isBot: !!p.isBot,
    })),
    isHost,
    myChoice: room.phase === "pick" ? myChoice : null,
    opponentPicked: room.phase === "pick" ? oppPicked : false,
    waitingForOpponent,
    rivalReady,
    result: null,
  };
}

function broadcastRps(io, room) {
  const rn = rpsRoomName(room.code);
  const allowed = new Set(room.players.filter((p) => !p.isBot).map((p) => p.id));

  io.in(rn)
    .fetchSockets()
    .then((socks) => {
      const got = new Set();
      for (const s of socks) {
        if (!allowed.has(s.id)) continue;
        s.emit("rps:update", serializeRpsRoom(room, s.id));
        got.add(s.id);
      }
      for (const p of room.players) {
        if (got.has(p.id)) continue;
        if (p.isBot) continue;
        io.to(p.id).emit("rps:update", serializeRpsRoom(room, p.id));
      }
    })
    .catch(() => {
      room.players.forEach((p) => {
        if (p.isBot) return;
        io.to(p.id).emit("rps:update", serializeRpsRoom(room, p.id));
      });
    });
}

/** איקס-עיגול */
const xoRooms = new Map();
const pendingXoLeave = new Map();

function cancelPendingXoLeave(socketId) {
  const t = pendingXoLeave.get(socketId);
  if (t) {
    clearTimeout(t);
    pendingXoLeave.delete(socketId);
  }
}

function xoRoomName(code) {
  return `xo:${code}`;
}

function emptyXoBoard() {
  return Array(9).fill(null);
}

function xoCheckWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function xoCheckDraw(board) {
  return board.every((c) => c !== null && c !== undefined);
}

/** Minimax: הבוט (O) ממקסם, השחקן (X) ממזער. עומק משמש לשבירת תיקו — ניצחון מהיר עדיף. */
function xoMinimaxScore(board, depth, isMaximizing, botSym, humanSym) {
  const w = xoCheckWinner(board);
  if (w === botSym) return 10 - depth;
  if (w === humanSym) return depth - 10;
  if (xoCheckDraw(board)) return 0;

  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] != null && board[i] !== undefined) continue;
      board[i] = botSym;
      const s = xoMinimaxScore(board, depth + 1, false, botSym, humanSym);
      board[i] = null;
      if (s > best) best = s;
    }
    return best;
  }
  let best = Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i] != null && board[i] !== undefined) continue;
    board[i] = humanSym;
    const s = xoMinimaxScore(board, depth + 1, true, botSym, humanSym);
    board[i] = null;
    if (s < best) best = s;
  }
  return best;
}

const XO_MOVE_PREF = [4, 0, 2, 6, 8, 1, 3, 5, 7];

/** חלק מהמהלכים אקראיים חוקיים — לא אופטימלי, כדי לאפשר ניצחון מדי פעם */
const XO_BOT_RANDOM_MOVE_CHANCE = 0.27;

function xoPickBotMove(board) {
  const legal = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] != null && board[i] !== undefined) continue;
    legal.push(i);
  }
  if (legal.length === 0) return -1;
  if (Math.random() < XO_BOT_RANDOM_MOVE_CHANCE) {
    return legal[Math.floor(Math.random() * legal.length)];
  }
  return xoPickBestMove(board);
}

function xoPickBestMove(board) {
  const botSym = "O";
  const humanSym = "X";
  let bestScore = -Infinity;
  const candidates = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] != null && board[i] !== undefined) continue;
    board[i] = botSym;
    const s = xoMinimaxScore(board, 0, false, botSym, humanSym);
    board[i] = null;
    if (s > bestScore) {
      bestScore = s;
      candidates.length = 0;
      candidates.push(i);
    } else if (s === bestScore) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];
  for (const pref of XO_MOVE_PREF) {
    if (candidates.includes(pref)) return pref;
  }
  return candidates[0];
}

function buildXoLastResult(room, draw, winnerPlayer) {
  return {
    draw: !!draw,
    winnerName: winnerPlayer ? winnerPlayer.name : null,
    winnerId: winnerPlayer ? winnerPlayer.id : null,
    line: draw ? "תיקו!" : `${winnerPlayer.name} מנצח/ת!`,
    board: [...room.board],
    scores: room.players.map((p) => ({
      name: p.name,
      wins: p.wins || 0,
      isBot: !!p.isBot,
    })),
  };
}

function createXoRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (xoRooms.has(code));

  const room = {
    code,
    solo: false,
    hostId: hostSocketId,
    mode: "pvp",
    phase: "lobby",
    players: [{ id: hostSocketId, name: hostName, clientId, wins: 0, symbol: "X" }],
    board: emptyXoBoard(),
    currentTurn: null,
    lastResult: null,
  };
  xoRooms.set(code, room);
  return room;
}

function createXoSoloRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (xoRooms.has(code));

  const botId = `xobot:${code}`;
  const room = {
    code,
    solo: true,
    hostId: hostSocketId,
    mode: "bot",
    phase: "lobby",
    players: [
      { id: hostSocketId, name: hostName, clientId, wins: 0, symbol: "X" },
      { id: botId, name: "בוט", clientId: "xo-bot", isBot: true, wins: 0, symbol: "O" },
    ],
    board: emptyXoBoard(),
    currentTurn: null,
    lastResult: null,
  };
  xoRooms.set(code, room);
  return room;
}

function leaveXoRoom(socketId, io) {
  for (const [code, room] of xoRooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);
    if (room.players.length === 0 || room.solo) {
      xoRooms.delete(code);
      return;
    }
    if (room.hostId === socketId && room.players[0]) {
      room.hostId = room.players[0].id;
      room.players[0].symbol = "X";
      if (room.players[1]) room.players[1].symbol = "O";
    }
    if (room.players.length < 2) {
      room.phase = "lobby";
      room.board = emptyXoBoard();
      room.currentTurn = null;
      room.lastResult = null;
    }
    broadcastXo(io, room);
    return;
  }
}

function runBotXoMove(io, code) {
  const room = xoRooms.get(code);
  if (!room || room.phase !== "playing") return;
  const bot = room.players.find((p) => p.isBot);
  const human = room.players.find((p) => !p.isBot);
  if (!bot || !human || room.currentTurn !== bot.id) return;

  const idx = xoPickBotMove(room.board);
  if (idx < 0) return;
  room.board[idx] = "O";

  const w = xoCheckWinner(room.board);
  if (w) {
    const winner = room.players.find((p) => p.symbol === w);
    if (winner) winner.wins = (winner.wins || 0) + 1;
    room.phase = "result";
    room.lastResult = buildXoLastResult(room, false, winner);
    broadcastXo(io, room);
    return;
  }

  if (xoCheckDraw(room.board)) {
    room.phase = "result";
    room.lastResult = buildXoLastResult(room, true, null);
    broadcastXo(io, room);
    return;
  }

  room.currentTurn = human.id;
  broadcastXo(io, room);
}

function serializeXoRoom(room, forSocketId) {
  const isHost = room.hostId === forSocketId;
  const me = room.players.find((p) => p.id === forSocketId);

  if (room.phase === "result" && room.lastResult) {
    return {
      code: room.code,
      phase: room.phase,
      mode: room.mode,
      solo: !!room.solo,
      players: room.players.map((p) => ({
        name: p.name,
        isYou: p.id === forSocketId,
        isBot: !!p.isBot,
        symbol: p.symbol,
        wins: p.wins || 0,
      })),
      isHost,
      board: [...room.board],
      currentTurn: null,
      isMyTurn: false,
      mySymbol: me ? me.symbol : null,
      result: room.lastResult,
    };
  }

  return {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    solo: !!room.solo,
    players: room.players.map((p) => ({
      name: p.name,
      isYou: p.id === forSocketId,
      isBot: !!p.isBot,
      symbol: p.symbol,
      wins: p.wins || 0,
    })),
    isHost,
    board: room.phase === "playing" ? [...room.board] : null,
    currentTurn: room.currentTurn,
    isMyTurn: room.phase === "playing" && room.currentTurn === forSocketId,
    mySymbol: me ? me.symbol : null,
    result: null,
  };
}

function broadcastXo(io, room) {
  const rn = xoRoomName(room.code);
  const allowed = new Set(room.players.filter((p) => !p.isBot).map((p) => p.id));

  io.in(rn)
    .fetchSockets()
    .then((socks) => {
      const got = new Set();
      for (const s of socks) {
        if (!allowed.has(s.id)) continue;
        s.emit("xo:update", serializeXoRoom(room, s.id));
        got.add(s.id);
      }
      for (const p of room.players) {
        if (got.has(p.id)) continue;
        if (p.isBot) continue;
        io.to(p.id).emit("xo:update", serializeXoRoom(room, p.id));
      }
    })
    .catch(() => {
      room.players.forEach((p) => {
        if (p.isBot) return;
        io.to(p.id).emit("xo:update", serializeXoRoom(room, p.id));
      });
    });
}

/** טאקי — עד 4 שחקנים, מול בוט או מרובה משתתפים */
const takiRooms = new Map();
const pendingTakiLeave = new Map();

const TAKI_COLORS = ["R", "Y", "B", "G"];

function cancelPendingTakiLeave(socketId) {
  const t = pendingTakiLeave.get(socketId);
  if (t) {
    clearTimeout(t);
    pendingTakiLeave.delete(socketId);
  }
}

function takiRoomName(code) {
  return `taki:${code}`;
}

function takiMakeCard(spec) {
  return { id: crypto.randomUUID(), ...spec };
}

function buildTakiDeck() {
  const deck = [];
  for (const color of TAKI_COLORS) {
    for (let n = 1; n <= 9; n++) {
      deck.push(takiMakeCard({ type: "num", color, value: n }));
    }
    deck.push(takiMakeCard({ type: "plus2", color }));
    deck.push(takiMakeCard({ type: "stop", color }));
    deck.push(takiMakeCard({ type: "reverse", color }));
    deck.push(takiMakeCard({ type: "taki", color }));
  }
  for (let i = 0; i < 4; i++) {
    deck.push(takiMakeCard({ type: "change", color: null }));
  }
  return deck;
}

function shuffleTakiDeck(deck) {
  const a = deck;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function takiCardPoints(c) {
  if (!c) return 0;
  if (c.type === "num") return c.value || 0;
  if (c.type === "change") return 15;
  return 10;
}

function takiHandPoints(cards) {
  return (cards || []).reduce((s, c) => s + takiCardPoints(c), 0);
}

function takiReshuffleDiscardIfNeeded(room) {
  if (room.deck.length > 0 || room.discard.length < 2) return;
  const top = room.discard.pop();
  const rest = room.discard.splice(0);
  shuffleTakiDeck(rest);
  room.deck = rest;
  room.discard = [top];
}

function takiTop(room) {
  return room.discard.length ? room.discard[room.discard.length - 1] : null;
}

/** האם כרטיס מתאים לקלף העליון (מצב רגיל, לא טאקי) */
function takiMatchesDiscard(card, top) {
  if (!top) return true;
  if (card.type === "change") return true;
  if (top.type === "change") {
    return card.color === top.color;
  }
  if (card.type === "plus2" && top.type === "plus2") return true;
  if (card.type === "stop" && top.type === "stop") return true;
  if (card.type === "reverse" && top.type === "reverse") return true;
  if (card.color && top.color && card.color === top.color) return true;
  if (card.type === "num" && top.type === "num" && card.value === top.value) return true;
  return false;
}

function takiCurrentPlayer(room) {
  const n = room.players.length;
  if (n === 0) return null;
  return room.players[((room.turnIndex % n) + n) % n];
}

function takiAdvanceTurn(room, steps) {
  const n = room.players.length;
  let s = steps;
  while (s > 0) {
    room.turnIndex = (room.turnIndex + room.direction + n) % n;
    s--;
  }
}

function createTakiRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (takiRooms.has(code));

  const room = {
    code,
    solo: false,
    hostId: hostSocketId,
    mode: "pvp",
    phase: "lobby",
    players: [{ id: hostSocketId, name: hostName, clientId, score: 0, hand: [], isBot: false }],
    deck: [],
    discard: [],
    turnIndex: 0,
    direction: 1,
    takiMode: null,
    plus2Stack: 0,
    colorPickPlayerId: null,
    lastResult: null,
  };
  takiRooms.set(code, room);
  return room;
}

function createTakiSoloRoom(hostSocketId, hostName, clientId) {
  let code;
  do {
    code = randomRoomCode();
  } while (takiRooms.has(code));

  const room = {
    code,
    solo: true,
    hostId: hostSocketId,
    mode: "bot",
    phase: "lobby",
    players: [
      { id: hostSocketId, name: hostName, clientId, score: 0, hand: [], isBot: false },
      { id: `takibot:${code}:1`, name: "בוט א׳", clientId: "taki-bot-1", score: 0, hand: [], isBot: true },
      { id: `takibot:${code}:2`, name: "בוט ב׳", clientId: "taki-bot-2", score: 0, hand: [], isBot: true },
      { id: `takibot:${code}:3`, name: "בוט ג׳", clientId: "taki-bot-3", score: 0, hand: [], isBot: true },
    ],
    deck: [],
    discard: [],
    turnIndex: 0,
    direction: 1,
    takiMode: null,
    plus2Stack: 0,
    colorPickPlayerId: null,
    lastResult: null,
  };
  takiRooms.set(code, room);
  return room;
}

function leaveTakiRoom(socketId, io) {
  for (const [code, room] of takiRooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);
    if (room.players.length === 0 || room.solo) {
      takiRooms.delete(code);
      return;
    }
    if (room.hostId === socketId && room.players[0]) {
      room.hostId = room.players[0].id;
    }
    if (room.phase === "playing") {
      room.phase = "lobby";
      room.deck = [];
      room.discard = [];
      room.takiMode = null;
      room.plus2Stack = 0;
      room.colorPickPlayerId = null;
      room.players.forEach((p) => {
        p.hand = [];
      });
    }
    broadcastTaki(io, room);
    return;
  }
}

function takiStartRound(room) {
  let deck = shuffleTakiDeck(buildTakiDeck());
  const n = room.players.length;
  const per = 8;
  room.players.forEach((p) => {
    p.hand = [];
  });
  for (let r = 0; r < per; r++) {
    for (let i = 0; i < n; i++) {
      if (deck.length === 0) break;
      room.players[i].hand.push(deck.pop());
    }
  }
  room.deck = deck;
  room.discard = [];
  room.takiMode = null;
  room.plus2Stack = 0;
  room.colorPickPlayerId = null;
  room.direction = 1;
  room.turnIndex = 0;

  let starter = null;
  while (room.deck.length) {
    const c = room.deck.pop();
    if (c.type === "num") {
      starter = c;
      break;
    }
    room.deck.unshift(c);
    shuffleTakiDeck(room.deck);
  }
  if (!starter) {
    starter = takiMakeCard({ type: "num", color: "R", value: 1 });
  }
  room.discard.push(starter);
}

function takiLegalPlays(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return [];
  const top = takiTop(room);
  const out = [];

  if (room.colorPickPlayerId === playerId) {
    return [];
  }

  if (room.plus2Stack > 0) {
    for (const c of p.hand) {
      if (c.type === "plus2") out.push(c);
    }
    return out;
  }

  if (room.takiMode && room.takiMode.playerId === playerId) {
    const col = room.takiMode.color;
    for (const c of p.hand) {
      if (c.type === "change") continue;
      if (c.color === col) out.push(c);
    }
    return out;
  }

  for (const c of p.hand) {
    if (takiMatchesDiscard(c, top)) out.push(c);
  }
  return out;
}

function takiApplySpecialAfterPlay(room, card, playerId) {
  const n = room.players.length;
  if (card.type === "stop") {
    room.turnIndex = (room.turnIndex + 2 * room.direction + n * 10) % n;
    return;
  }
  if (card.type === "reverse") {
    room.direction *= -1;
    takiAdvanceTurn(room, 1);
    return;
  }
  if (card.type === "plus2") {
    room.plus2Stack += 1;
    takiAdvanceTurn(room, 1);
    return;
  }
  if (card.type === "taki") {
    room.takiMode = { color: card.color, playerId };
    return;
  }
  if (card.type === "change") {
    room.colorPickPlayerId = playerId;
    return;
  }
  takiAdvanceTurn(room, 1);
}

const TAKI_BOT_DELAY_MS = 450;
/** לאחר שבוט שיחק — המתנה ארוכה יותר לפני מהלך הבא של בוט, כדי שהשחקן יראה מה הונח */
const TAKI_BOT_TO_BOT_DELAY_MS = 1100;

function takiMaybeBot(io, code, lastActorId) {
  const room = takiRooms.get(code);
  if (!room || room.phase !== "playing") return;
  const cur = takiCurrentPlayer(room);
  if (!cur || !cur.isBot) return;
  let afterBot = false;
  if (lastActorId) {
    const prev = room.players.find((p) => p.id === lastActorId);
    afterBot = !!(prev && prev.isBot);
  }
  const delayMs = afterBot ? TAKI_BOT_TO_BOT_DELAY_MS : TAKI_BOT_DELAY_MS;
  scheduleBotTaki(io, code, delayMs);
}

function takiPlayCard(room, playerId, cardId, io, code) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: "לא נמצא" };
  const legal = takiLegalPlays(room, playerId);
  const card = p.hand.find((c) => c.id === cardId);
  if (!card || !legal.some((c) => c.id === cardId)) return { ok: false, error: "מהלך לא חוקי" };

  const idx = p.hand.findIndex((c) => c.id === cardId);
  p.hand.splice(idx, 1);
  room.discard.push(card);

  const win = takiCheckRoundWin(room, playerId);
  if (win) {
    room.phase = "result";
    room.lastResult = win;
    broadcastTaki(io, room);
    return { ok: true };
  }

  if (room.takiMode && room.takiMode.playerId === playerId) {
    if (card.type === "num" || card.type === "taki") {
      if (card.type === "taki") {
        room.takiMode = { color: card.color, playerId };
      }
      broadcastTaki(io, room);
      takiMaybeBot(io, code, playerId);
      return { ok: true };
    }
    room.takiMode = null;
    takiApplySpecialAfterPlay(room, card, playerId);
    broadcastTaki(io, room);
    takiMaybeBot(io, code, playerId);
    return { ok: true };
  }

  if (card.type === "change") {
    room.colorPickPlayerId = playerId;
    broadcastTaki(io, room);
    takiMaybeBot(io, code, playerId);
    return { ok: true };
  }

  takiApplySpecialAfterPlay(room, card, playerId);
  broadcastTaki(io, room);
  takiMaybeBot(io, code, playerId);
  return { ok: true };
}

function takiPickColor(room, playerId, color, io, code) {
  if (room.colorPickPlayerId !== playerId) return { ok: false, error: "לא נדרש בחירה" };
  if (!TAKI_COLORS.includes(color)) return { ok: false, error: "צבע לא חוקי" };
  const top = takiTop(room);
  if (top && top.type === "change") top.color = color;
  room.colorPickPlayerId = null;
  takiAdvanceTurn(room, 1);
  broadcastTaki(io, room);
  takiMaybeBot(io, code, playerId);
  return { ok: true };
}

function takiTakiDone(room, playerId, io, code) {
  if (!room.takiMode || room.takiMode.playerId !== playerId) return { ok: false, error: "לא במצב טאקי" };
  room.takiMode = null;
  takiAdvanceTurn(room, 1);
  broadcastTaki(io, room);
  takiMaybeBot(io, code, playerId);
  return { ok: true };
}

function takiDraw(room, playerId, io, code) {
  const cur = takiCurrentPlayer(room);
  if (!cur || cur.id !== playerId) return { ok: false, error: "לא התור שלך" };
  if (room.colorPickPlayerId) return { ok: false, error: "בחרו צבע" };

  if (room.plus2Stack > 0) {
    takiResolvePlus2Draw(room, playerId);
    const win = takiCheckRoundWin(room, playerId);
    if (win) {
      room.phase = "result";
      room.lastResult = win;
      broadcastTaki(io, room);
      return { ok: true };
    }
    broadcastTaki(io, room);
    takiMaybeBot(io, code, playerId);
    return { ok: true };
  }

  if (room.takiMode) {
    return { ok: false, error: "השתמשו בקלף או לחצו ״סיימתי״" };
  }

  const legal = takiLegalPlays(room, playerId);
  if (legal.length > 0) return { ok: false, error: "יש לכם מהלך חוקי" };

  takiReshuffleDiscardIfNeeded(room);
  const p = room.players.find((x) => x.id === playerId);
  if (room.deck.length > 0) {
    p.hand.push(room.deck.pop());
  }
  takiAdvanceTurn(room, 1);
  broadcastTaki(io, room);
  takiMaybeBot(io, code, playerId);
  return { ok: true };
}

function takiResolvePlus2Draw(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p || room.plus2Stack <= 0) return;
  const drawCount = 2 * room.plus2Stack;
  room.plus2Stack = 0;
  for (let i = 0; i < drawCount; i++) {
    takiReshuffleDiscardIfNeeded(room);
    if (room.deck.length === 0) break;
    p.hand.push(room.deck.pop());
  }
  takiAdvanceTurn(room, 1);
}

function takiCheckRoundWin(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p || p.hand.length > 0) return null;
  let gained = 0;
  for (const o of room.players) {
    if (o.id === playerId) continue;
    gained += takiHandPoints(o.hand);
  }
  p.score = (p.score || 0) + gained;
  return {
    winnerId: playerId,
    winnerName: p.name,
    roundPoints: gained,
    scores: room.players.map((x) => ({ name: x.name, score: x.score || 0, isBot: !!x.isBot })),
  };
}

function serializeTakiRoom(room, forSocketId) {
  const isHost = room.hostId === forSocketId;
  const me = room.players.find((p) => p.id === forSocketId);
  const top = takiTop(room);
  const cur = takiCurrentPlayer(room);

  if (room.phase === "result" && room.lastResult) {
    return {
      code: room.code,
      phase: room.phase,
      mode: room.mode,
      solo: !!room.solo,
      players: room.players.map((p) => ({
        name: p.name,
        isYou: p.id === forSocketId,
        isBot: !!p.isBot,
        score: p.score || 0,
        handCount: (p.hand && p.hand.length) || 0,
      })),
      isHost,
      topCard: top,
      deckCount: room.deck.length,
      discardCount: room.discard.length,
      turnIndex: room.turnIndex,
      direction: room.direction,
      currentPlayerId: cur ? cur.id : null,
      currentTurnName: cur ? cur.name : null,
      isMyTurn: false,
      myHand: me ? [...(me.hand || [])] : [],
      takiMode: room.takiMode,
      plus2Stack: room.plus2Stack,
      colorPickPlayerId: room.colorPickPlayerId,
      mustPickColor: room.colorPickPlayerId === forSocketId,
      inTakiChain: !!(room.takiMode && room.takiMode.playerId === forSocketId),
      result: room.lastResult,
    };
  }

  return {
    code: room.code,
    phase: room.phase,
    mode: room.mode,
    solo: !!room.solo,
    players: room.players.map((p) => ({
      name: p.name,
      isYou: p.id === forSocketId,
      isBot: !!p.isBot,
      score: p.score || 0,
      handCount: (p.hand && p.hand.length) || 0,
    })),
    isHost,
    topCard: top,
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    turnIndex: room.turnIndex,
    direction: room.direction,
    currentPlayerId: cur ? cur.id : null,
    currentTurnName: cur ? cur.name : null,
    isMyTurn: room.phase === "playing" && cur && cur.id === forSocketId && !room.colorPickPlayerId,
    myHand: me ? [...(me.hand || [])] : [],
    takiMode: room.takiMode,
    plus2Stack: room.plus2Stack,
    colorPickPlayerId: room.colorPickPlayerId,
    mustPickColor: room.colorPickPlayerId === forSocketId,
    inTakiChain: !!(room.takiMode && room.takiMode.playerId === forSocketId),
    result: null,
  };
}

function broadcastTaki(io, room) {
  const rn = takiRoomName(room.code);
  const allowed = new Set(room.players.filter((p) => !p.isBot).map((p) => p.id));

  io.in(rn)
    .fetchSockets()
    .then((socks) => {
      const got = new Set();
      for (const s of socks) {
        if (!allowed.has(s.id)) continue;
        s.emit("taki:update", serializeTakiRoom(room, s.id));
        got.add(s.id);
      }
      for (const p of room.players) {
        if (got.has(p.id)) continue;
        if (p.isBot) continue;
        io.to(p.id).emit("taki:update", serializeTakiRoom(room, p.id));
      }
    })
    .catch(() => {
      room.players.forEach((p) => {
        if (p.isBot) return;
        io.to(p.id).emit("taki:update", serializeTakiRoom(room, p.id));
      });
    });
}

function scheduleBotTaki(io, code, delayMs) {
  setTimeout(() => runBotTakiMove(io, code), delayMs || 500);
}

function runBotTakiMove(io, code) {
  const room = takiRooms.get(code);
  if (!room || room.phase !== "playing") return;
  const bot = takiCurrentPlayer(room);
  if (!bot || !bot.isBot) return;

  if (room.colorPickPlayerId === bot.id) {
    const col = TAKI_COLORS[Math.floor(Math.random() * TAKI_COLORS.length)];
    takiPickColor(room, bot.id, col, io, code);
    return;
  }

  if (room.plus2Stack > 0) {
    const legal = takiLegalPlays(room, bot.id);
    if (legal.length) {
      const card = legal[Math.floor(Math.random() * legal.length)];
      takiPlayCard(room, bot.id, card.id, io, code);
    } else {
      takiDraw(room, bot.id, io, code);
    }
    return;
  }

  if (room.takiMode && room.takiMode.playerId === bot.id) {
    const legal = takiLegalPlays(room, bot.id);
    if (legal.length) {
      const card = legal[Math.floor(Math.random() * legal.length)];
      takiPlayCard(room, bot.id, card.id, io, code);
    } else {
      takiTakiDone(room, bot.id, io, code);
    }
    return;
  }

  const legal = takiLegalPlays(room, bot.id);
  if (legal.length) {
    const card = legal[Math.floor(Math.random() * legal.length)];
    takiPlayCard(room, bot.id, card.id, io, code);
    return;
  }

  takiDraw(room, bot.id, io, code);
}

/** ארץ עיר */
const aeRooms = new Map();
const pendingAeLeave = new Map();

const AE_CATEGORIES = [
  { key: "eretz", label: "ארץ" },
  { key: "ir", label: "עיר" },
  { key: "hai", label: "חי" },
  { key: "tzomeach", label: "צומח" },
  { key: "domem", label: "דומם" },
  { key: "yeled", label: "ילד" },
  { key: "yalda", label: "ילדה" },
  { key: "mikzoa", label: "מקצוע" },
  { key: "ochel", label: "מאכל" },
];
const AE_CAT_KEYS = AE_CATEGORIES.map((c) => c.key);

const HEBREW_ALEPH_BET = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"];

function cancelPendingAeLeave(socketId) {
  const t = pendingAeLeave.get(socketId);
  if (t) {
    clearTimeout(t);
    pendingAeLeave.delete(socketId);
  }
}

function aeRoomName(code) {
  return `ae:${code}`;
}

function normalizeAeTime(sec) {
  const n = Number(sec);
  if (n === 90 || n === 180 || n === 300) return n;
  return 0;
}

function emptyAeAnswers() {
  return Object.fromEntries(AE_CAT_KEYS.map((k) => [k, ""]));
}

function randomHebrewLetter() {
  return HEBREW_ALEPH_BET[Math.floor(Math.random() * HEBREW_ALEPH_BET.length)];
}

function stripHebrewNiqqud(s) {
  return String(s).replace(/[\u0591-\u05C7]/g, "");
}

function normalizeAeWord(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

function firstLetterForAe(word) {
  const t = stripHebrewNiqqud(normalizeAeWord(word));
  return t ? t[0] : "";
}

function wordStartsWithLetter(w, letter) {
  return firstLetterForAe(w) === letter;
}

function isValidHebrewWord(w) {
  const t = stripHebrewNiqqud(normalizeAeWord(w));
  if (t.length < 2) return false;
  const parts = t.split(" ").filter(Boolean);
  if (parts.length > 2) return false;
  const hebrewOnly = /^[\u05D0-\u05EA]+$/;
  if (parts.length === 1) {
    return parts[0].length >= 2 && hebrewOnly.test(parts[0]);
  }
  return (
    parts[0].length >= 2 &&
    parts[1].length >= 2 &&
    hebrewOnly.test(parts[0]) &&
    hebrewOnly.test(parts[1])
  );
}

function sanitizeAeAnswers(payload) {
  const out = emptyAeAnswers();
  if (!payload || typeof payload !== "object") return out;
  for (const k of AE_CAT_KEYS) {
    out[k] = String(payload[k] != null ? payload[k] : "").trim();
  }
  return out;
}

function scoreAeRound(room) {
  const letter = room.letter;
  const breakdown = {};
  for (const p of room.players) {
    breakdown[p.id] = { name: p.name, categories: {}, roundTotal: 0 };
    for (const c of AE_CAT_KEYS) breakdown[p.id].categories[c] = 0;
  }
  for (const cat of AE_CAT_KEYS) {
    const wordToIds = new Map();
    for (const p of room.players) {
      const raw = (p.answers && p.answers[cat]) || "";
      const w = normalizeAeWord(raw);
      if (!w) continue;
      if (!wordStartsWithLetter(w, letter)) continue;
      if (!isValidHebrewWord(w)) continue;
      const key = normalizeAeWord(stripHebrewNiqqud(w));
      if (!wordToIds.has(key)) wordToIds.set(key, []);
      wordToIds.get(key).push(p.id);
    }
    for (const p of room.players) {
      const raw = (p.answers && p.answers[cat]) || "";
      const w = normalizeAeWord(raw);
      let pts = 0;
      if (!w) pts = 0;
      else if (!wordStartsWithLetter(w, letter)) pts = 0;
      else if (!isValidHebrewWord(w)) pts = 0;
      else {
        const key = normalizeAeWord(stripHebrewNiqqud(w));
        const lst = wordToIds.get(key) || [];
        pts = lst.length >= 2 ? 1 : 2;
      }
      breakdown[p.id].categories[cat] = pts;
      breakdown[p.id].roundTotal += pts;
    }
  }
  for (const p of room.players) {
    room.totals[p.id] = (room.totals[p.id] || 0) + breakdown[p.id].roundTotal;
  }
  room.history.push({
    letter,
    breakdown: JSON.parse(JSON.stringify(breakdown)),
    totalsAfter: { ...room.totals },
  });
  room.lastBreakdown = breakdown;
}

function clearAeRoundTimer(room) {
  if (room.roundTimerId) {
    clearTimeout(room.roundTimerId);
    room.roundTimerId = null;
  }
}

function finalizeAeRound(io, code) {
  const room = aeRooms.get(code);
  if (!room || room.phase !== "playing") return;
  clearAeRoundTimer(room);
  for (const p of room.players) {
    if (!p.done) {
      p.done = true;
      p.answers = p.answers || emptyAeAnswers();
    }
  }
  scoreAeRound(room);
  room.phase = "results";
  broadcastAe(io, room);
}

function tryFinalizeAeRound(io, code) {
  const room = aeRooms.get(code);
  if (!room || room.phase !== "playing") return;
  const allDone = room.players.every((p) => p.done);
  if (allDone) {
    clearAeRoundTimer(room);
    finalizeAeRound(io, code);
  }
}

function scheduleAeRoundTimer(io, code) {
  const room = aeRooms.get(code);
  if (!room || room.phase !== "playing" || !room.timeLimitSec || room.timeLimitSec <= 0) return;
  clearAeRoundTimer(room);
  const ms = Math.max(0, room.roundDeadline - Date.now());
  room.roundTimerId = setTimeout(() => finalizeAeRound(io, code), ms);
}

function createAeRoom(hostSocketId, hostName, clientId, timeLimitSec) {
  let code;
  do {
    code = randomRoomCode();
  } while (aeRooms.has(code));

  const room = {
    code,
    solo: false,
    hostId: hostSocketId,
    phase: "lobby",
    timeLimitSec: normalizeAeTime(timeLimitSec),
    players: [{ id: hostSocketId, name: hostName, clientId, done: false, answers: null }],
    letter: null,
    roundDeadline: null,
    roundTimerId: null,
    totals: {},
    history: [],
    lastBreakdown: null,
  };
  aeRooms.set(code, room);
  return room;
}

function createAeSoloRoom(hostSocketId, hostName, clientId, timeLimitSec) {
  let code;
  do {
    code = randomRoomCode();
  } while (aeRooms.has(code));

  const room = {
    code,
    solo: true,
    hostId: hostSocketId,
    phase: "lobby",
    timeLimitSec: normalizeAeTime(timeLimitSec),
    players: [{ id: hostSocketId, name: hostName, clientId, done: false, answers: null }],
    letter: null,
    roundDeadline: null,
    roundTimerId: null,
    totals: {},
    history: [],
    lastBreakdown: null,
  };
  aeRooms.set(code, room);
  return room;
}

function leaveAeRoom(socketId, io) {
  for (const [code, room] of aeRooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    clearAeRoundTimer(room);
    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      aeRooms.delete(code);
      return;
    }
    if (room.hostId === socketId && room.players[0]) {
      room.hostId = room.players[0].id;
    }
    broadcastAe(io, room);
    return;
  }
}

function serializeAeRoom(room, forSocketId) {
  const isHost = room.hostId === forSocketId;
  const me = room.players.find((p) => p.id === forSocketId);
  const base = {
    code: room.code,
    solo: !!room.solo,
    phase: room.phase,
    players: room.players.map((p) => ({
      name: p.name,
      isYou: p.id === forSocketId,
      id: p.id,
      done: !!p.done,
    })),
    isHost,
    timeLimitSec: room.timeLimitSec,
    categories: AE_CATEGORIES,
  };

  if (room.phase === "lobby") {
    return { ...base, letter: null, roundDeadline: null, myAnswers: null, lastBreakdown: null, totals: room.totals, history: room.history };
  }
  if (room.phase === "playing") {
    return {
      ...base,
      letter: room.letter,
      roundDeadline: room.roundDeadline,
      myAnswers: me && me.answers ? { ...me.answers } : emptyAeAnswers(),
      lastBreakdown: null,
      totals: room.totals,
      history: room.history,
    };
  }
  if (room.phase === "results") {
    return {
      ...base,
      letter: room.letter,
      roundDeadline: null,
      myAnswers: me && me.answers ? { ...me.answers } : emptyAeAnswers(),
      lastBreakdown: room.lastBreakdown,
      totals: room.totals,
      history: room.history,
      roundPlayerAnswers: room.players.map((p) => ({
        name: p.name,
        isYou: p.id === forSocketId,
        answers: p.answers ? { ...p.answers } : emptyAeAnswers(),
      })),
    };
  }
  return base;
}

function broadcastAe(io, room) {
  const rn = aeRoomName(room.code);
  const allowed = new Set(room.players.map((p) => p.id));

  io.in(rn)
    .fetchSockets()
    .then((socks) => {
      const got = new Set();
      for (const s of socks) {
        if (!allowed.has(s.id)) continue;
        s.emit("ae:update", serializeAeRoom(room, s.id));
        got.add(s.id);
      }
      for (const p of room.players) {
        if (got.has(p.id)) continue;
        io.to(p.id).emit("ae:update", serializeAeRoom(room, p.id));
      }
    })
    .catch(() => {
      room.players.forEach((p) => {
        io.to(p.id).emit("ae:update", serializeAeRoom(room, p.id));
      });
    });
}

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
  else if (urlPath.endsWith("/")) urlPath = urlPath + "index.html";
  else if (!path.extname(urlPath)) urlPath = urlPath + "/index.html";
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

      const oldId = p.id;
      cancelPendingLeave(oldId);
      p.id = socket.id;
      socket.data.roomCode = room.code;
      socket.data.clientId = clientId;
      socket.join(room.code);
      broadcastRoom(io, room);
      return;
    }

    for (const room of rpsRooms.values()) {
      const p = room.players.find((x) => x.clientId === clientId && !x.isBot);
      if (!p) continue;

      const oldId = p.id;
      cancelPendingRpsLeave(oldId);
      p.id = socket.id;
      socket.data.rpsCode = room.code;
      socket.data.rpsClientId = clientId;
      socket.join(rpsRoomName(room.code));
      broadcastRps(io, room);
      return;
    }

    for (const room of aeRooms.values()) {
      const p = room.players.find((x) => x.clientId === clientId);
      if (!p) continue;

      const oldId = p.id;
      cancelPendingAeLeave(oldId);
      p.id = socket.id;
      socket.data.aeCode = room.code;
      socket.data.aeClientId = clientId;
      socket.join(aeRoomName(room.code));
      broadcastAe(io, room);
      return;
    }

    for (const room of xoRooms.values()) {
      const p = room.players.find((x) => x.clientId === clientId && !x.isBot);
      if (!p) continue;

      const oldId = p.id;
      cancelPendingXoLeave(oldId);
      p.id = socket.id;
      socket.data.xoCode = room.code;
      socket.data.xoClientId = clientId;
      socket.join(xoRoomName(room.code));
      broadcastXo(io, room);
      return;
    }

    for (const room of takiRooms.values()) {
      const p = room.players.find((x) => x.clientId === clientId && !x.isBot);
      if (!p) continue;

      const oldId = p.id;
      cancelPendingTakiLeave(oldId);
      p.id = socket.id;
      socket.data.takiCode = room.code;
      socket.data.takiClientId = clientId;
      socket.join(takiRoomName(room.code));
      broadcastTaki(io, room);
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
    cancelPendingLeave(socket.id);
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

  socket.on("rps:create", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId =
      (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createRpsRoom(socket.id, nv.name, clientId);
    socket.join(rpsRoomName(room.code));
    socket.data.rpsCode = room.code;
    socket.data.rpsClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRpsRoom(room, socket.id) });
    else socket.emit("rps:update", serializeRpsRoom(room, socket.id));
  });

  socket.on("rps:createSolo", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId =
      (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createRpsSoloRoom(socket.id, nv.name, clientId);
    socket.join(rpsRoomName(room.code));
    socket.data.rpsCode = room.code;
    socket.data.rpsClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRpsRoom(room, socket.id) });
    else socket.emit("rps:update", serializeRpsRoom(room, socket.id));
  });

  socket.on("rps:join", (payload, cb) => {
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
    const room = rpsRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    if (room.solo) {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן להצטרף — משחק מול בוט" });
      return;
    }
    if (room.players.length >= 2) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר מלא" });
      return;
    }
    room.players.push({ id: socket.id, name: nv.name, clientId, choice: null, wins: 0 });
    socket.join(rpsRoomName(code));
    socket.data.rpsCode = code;
    socket.data.rpsClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeRpsRoom(room, socket.id) });
    broadcastRps(io, room);
  });

  socket.on("rps:leave", (payload, cb) => {
    const code = socket.data.rpsCode;
    const room = code && rpsRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    cancelPendingRpsLeave(socket.id);
    leaveRpsRoom(socket.id, io);
    socket.leave(rpsRoomName(code));
    delete socket.data.rpsCode;
    delete socket.data.rpsClientId;
    socket.emit("rps:update", null);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("rps:requestSync", () => {
    const code = socket.data.rpsCode;
    const room = code && rpsRooms.get(code);
    if (!room || !room.players.some((p) => p.id === socket.id && !p.isBot)) return;
    socket.emit("rps:update", serializeRpsRoom(room, socket.id));
  });

  socket.on("rps:start", (payload, cb) => {
    const code = socket.data.rpsCode;
    const room = code && rpsRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח יכול להתחיל" });
      return;
    }
    if (room.players.length < 2) {
      if (typeof cb === "function") cb({ ok: false, error: "נדרשים שני שחקנים" });
      return;
    }
    room.phase = "pick";
    room.players.forEach((p) => {
      p.choice = null;
    });
    room.lastResult = null;
    broadcastRps(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("rps:pick", (payload, cb) => {
    const code = socket.data.rpsCode;
    const room = code && rpsRooms.get(code);
    if (!room || room.phase !== "pick") {
      if (typeof cb === "function") cb({ ok: false, error: "לא בשלב בחירה" });
      return;
    }
    const choice = payload && payload.choice;
    if (!["rock", "paper", "scissors"].includes(choice)) {
      if (typeof cb === "function") cb({ ok: false, error: "בחירה לא חוקית" });
      return;
    }
    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.isBot) {
      if (typeof cb === "function") cb({ ok: false, error: "לא התור שלך" });
      return;
    }
    if (me.choice) {
      if (typeof cb === "function") cb({ ok: false, error: "כבר בחרת" });
      return;
    }
    me.choice = choice;

    if (room.mode === "bot") {
      const bot = room.players.find((p) => p.isBot);
      const opts = ["rock", "paper", "scissors"];
      bot.choice = opts[Math.floor(Math.random() * opts.length)];
      resolveRpsRound(room);
      broadcastRps(io, room);
      if (typeof cb === "function") cb({ ok: true });
      return;
    }

    const allReady = room.players.every((p) => p.choice);
    if (allReady) {
      resolveRpsRound(room);
    }
    broadcastRps(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("rps:again", (payload, cb) => {
    const code = socket.data.rpsCode;
    const room = code && rpsRooms.get(code);
    if (!room || room.phase !== "result") {
      if (typeof cb === "function") cb({ ok: false, error: "לא אפשרי" });
      return;
    }
    room.phase = "pick";
    room.players.forEach((p) => {
      p.choice = null;
    });
    room.lastResult = null;
    broadcastRps(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:create", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createAeRoom(socket.id, nv.name, clientId, payload && payload.timeLimitSec);
    socket.join(aeRoomName(room.code));
    socket.data.aeCode = room.code;
    socket.data.aeClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeAeRoom(room, socket.id) });
    else socket.emit("ae:update", serializeAeRoom(room, socket.id));
  });

  socket.on("ae:createSolo", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createAeSoloRoom(socket.id, nv.name, clientId, payload && payload.timeLimitSec);
    socket.join(aeRoomName(room.code));
    socket.data.aeCode = room.code;
    socket.data.aeClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeAeRoom(room, socket.id) });
    else socket.emit("ae:update", serializeAeRoom(room, socket.id));
  });

  socket.on("ae:join", (payload, cb) => {
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
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = aeRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    if (room.solo) {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן להצטרף — משחק לבד" });
      return;
    }
    if (room.players.length >= 12) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר מלא" });
      return;
    }
    room.players.push({ id: socket.id, name: nv.name, clientId, done: false, answers: null });
    socket.join(aeRoomName(code));
    socket.data.aeCode = code;
    socket.data.aeClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeAeRoom(room, socket.id) });
    broadcastAe(io, room);
  });

  socket.on("ae:leave", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    cancelPendingAeLeave(socket.id);
    leaveAeRoom(socket.id, io);
    socket.leave(aeRoomName(code));
    delete socket.data.aeCode;
    delete socket.data.aeClientId;
    socket.emit("ae:update", null);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:requestSync", () => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || !room.players.some((p) => p.id === socket.id)) return;
    socket.emit("ae:update", serializeAeRoom(room, socket.id));
  });

  socket.on("ae:setTime", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || room.hostId !== socket.id || room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח בלובי" });
      return;
    }
    room.timeLimitSec = normalizeAeTime(payload && payload.seconds);
    broadcastAe(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:start", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח יכול להתחיל" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "לא בלובי" });
      return;
    }
    if (room.players.length < 1) {
      if (typeof cb === "function") cb({ ok: false, error: "אין שחקנים" });
      return;
    }
    room.phase = "playing";
    room.letter = randomHebrewLetter();
    room.players.forEach((p) => {
      p.done = false;
      p.answers = emptyAeAnswers();
    });
    room.roundDeadline = room.timeLimitSec > 0 ? Date.now() + room.timeLimitSec * 1000 : null;
    broadcastAe(io, room);
    scheduleAeRoundTimer(io, code);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:draft", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.done) {
      if (typeof cb === "function") cb({ ok: false, error: "כבר סיימת" });
      return;
    }
    me.answers = sanitizeAeAnswers(payload && payload.answers);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:done", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const me = room.players.find((p) => p.id === socket.id);
    if (!me) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    me.answers = sanitizeAeAnswers(payload && payload.answers);
    me.done = true;
    broadcastAe(io, room);
    tryFinalizeAeRound(io, code);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("ae:nextRound", (payload, cb) => {
    const code = socket.data.aeCode;
    const room = code && aeRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח" });
      return;
    }
    if (room.phase !== "results") {
      if (typeof cb === "function") cb({ ok: false, error: "לא אחרי סיבוב" });
      return;
    }
    clearAeRoundTimer(room);
    room.phase = "playing";
    room.letter = randomHebrewLetter();
    room.players.forEach((p) => {
      p.done = false;
      p.answers = emptyAeAnswers();
    });
    room.roundDeadline = room.timeLimitSec > 0 ? Date.now() + room.timeLimitSec * 1000 : null;
    room.lastBreakdown = null;
    broadcastAe(io, room);
    scheduleAeRoundTimer(io, code);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("xo:create", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createXoRoom(socket.id, nv.name, clientId);
    socket.join(xoRoomName(room.code));
    socket.data.xoCode = room.code;
    socket.data.xoClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeXoRoom(room, socket.id) });
    else socket.emit("xo:update", serializeXoRoom(room, socket.id));
  });

  socket.on("xo:createSolo", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createXoSoloRoom(socket.id, nv.name, clientId);
    socket.join(xoRoomName(room.code));
    socket.data.xoCode = room.code;
    socket.data.xoClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeXoRoom(room, socket.id) });
    else socket.emit("xo:update", serializeXoRoom(room, socket.id));
  });

  socket.on("xo:join", (payload, cb) => {
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
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = xoRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    if (room.solo) {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן להצטרף — משחק מול בוט" });
      return;
    }
    if (room.players.length >= 2) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר מלא" });
      return;
    }
    room.players.push({ id: socket.id, name: nv.name, clientId, wins: 0, symbol: "O" });
    socket.join(xoRoomName(code));
    socket.data.xoCode = code;
    socket.data.xoClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeXoRoom(room, socket.id) });
    broadcastXo(io, room);
  });

  socket.on("xo:leave", (payload, cb) => {
    const code = socket.data.xoCode;
    const room = code && xoRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    cancelPendingXoLeave(socket.id);
    leaveXoRoom(socket.id, io);
    socket.leave(xoRoomName(code));
    delete socket.data.xoCode;
    delete socket.data.xoClientId;
    socket.emit("xo:update", null);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("xo:requestSync", () => {
    const code = socket.data.xoCode;
    const room = code && xoRooms.get(code);
    if (!room || !room.players.some((p) => p.id === socket.id && !p.isBot)) return;
    socket.emit("xo:update", serializeXoRoom(room, socket.id));
  });

  socket.on("xo:start", (payload, cb) => {
    const code = socket.data.xoCode;
    const room = code && xoRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח יכול להתחיל" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "לא בלובי" });
      return;
    }
    if (room.players.length < 2) {
      if (typeof cb === "function") cb({ ok: false, error: "נדרשים שני שחקנים" });
      return;
    }
    room.board = emptyXoBoard();
    room.phase = "playing";
    room.currentTurn = room.players[0].id;
    room.lastResult = null;
    broadcastXo(io, room);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("xo:move", (payload, cb) => {
    const code = socket.data.xoCode;
    const room = code && xoRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.isBot) {
      if (typeof cb === "function") cb({ ok: false, error: "לא התור שלך" });
      return;
    }
    if (room.currentTurn !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "לא התור שלך" });
      return;
    }
    const index = payload && Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index > 8) {
      if (typeof cb === "function") cb({ ok: false, error: "מקום לא חוקי" });
      return;
    }
    if (room.board[index] !== null && room.board[index] !== undefined) {
      if (typeof cb === "function") cb({ ok: false, error: "תפוס" });
      return;
    }
    room.board[index] = me.symbol;
    const w = xoCheckWinner(room.board);
    if (w) {
      const winner = room.players.find((p) => p.symbol === w);
      if (winner) winner.wins = (winner.wins || 0) + 1;
      room.phase = "result";
      room.lastResult = buildXoLastResult(room, false, winner);
      broadcastXo(io, room);
      if (typeof cb === "function") cb({ ok: true });
      return;
    }
    if (xoCheckDraw(room.board)) {
      room.phase = "result";
      room.lastResult = buildXoLastResult(room, true, null);
      broadcastXo(io, room);
      if (typeof cb === "function") cb({ ok: true });
      return;
    }
    const other = room.players.find((p) => p.id !== me.id);
    room.currentTurn = other.id;
    broadcastXo(io, room);
    if (typeof cb === "function") cb({ ok: true });
    if (other && other.isBot) {
      setTimeout(() => runBotXoMove(io, code), 450);
    }
  });

  socket.on("xo:again", (payload, cb) => {
    const code = socket.data.xoCode;
    const room = code && xoRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח" });
      return;
    }
    if (room.phase !== "result") {
      if (typeof cb === "function") cb({ ok: false, error: "לא אפשרי" });
      return;
    }
    room.phase = "playing";
    room.board = emptyXoBoard();
    room.currentTurn = room.players[0].id;
    room.lastResult = null;
    broadcastXo(io, room);
    const bot = room.players.find((p) => p.isBot);
    if (bot && room.currentTurn === bot.id) {
      setTimeout(() => runBotXoMove(io, code), 400);
    }
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("taki:create", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createTakiRoom(socket.id, nv.name, clientId);
    socket.join(takiRoomName(room.code));
    socket.data.takiCode = room.code;
    socket.data.takiClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeTakiRoom(room, socket.id) });
    else socket.emit("taki:update", serializeTakiRoom(room, socket.id));
  });

  socket.on("taki:createSolo", (payload, cb) => {
    const nv = normalizePlayerName(payload && payload.name);
    if (!nv.ok) {
      if (typeof cb === "function") cb({ ok: false, error: nv.error });
      return;
    }
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = createTakiSoloRoom(socket.id, nv.name, clientId);
    socket.join(takiRoomName(room.code));
    socket.data.takiCode = room.code;
    socket.data.takiClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeTakiRoom(room, socket.id) });
    else socket.emit("taki:update", serializeTakiRoom(room, socket.id));
  });

  socket.on("taki:join", (payload, cb) => {
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
    const clientId = (payload && payload.clientId && String(payload.clientId)) || crypto.randomUUID();
    const room = takiRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר לא נמצא" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "המשחק כבר התחיל" });
      return;
    }
    if (room.solo) {
      if (typeof cb === "function") cb({ ok: false, error: "לא ניתן להצטרף — משחק מול בוט" });
      return;
    }
    if (room.players.length >= 4) {
      if (typeof cb === "function") cb({ ok: false, error: "החדר מלא (עד 4 שחקנים)" });
      return;
    }
    room.players.push({ id: socket.id, name: nv.name, clientId, score: 0, hand: [], isBot: false });
    socket.join(takiRoomName(code));
    socket.data.takiCode = code;
    socket.data.takiClientId = clientId;
    if (typeof cb === "function") cb({ ok: true, room: serializeTakiRoom(room, socket.id) });
    broadcastTaki(io, room);
  });

  socket.on("taki:leave", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room) {
      if (typeof cb === "function") cb({ ok: false, error: "לא בחדר" });
      return;
    }
    cancelPendingTakiLeave(socket.id);
    leaveTakiRoom(socket.id, io);
    socket.leave(takiRoomName(code));
    delete socket.data.takiCode;
    delete socket.data.takiClientId;
    socket.emit("taki:update", null);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("taki:requestSync", () => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || !room.players.some((p) => p.id === socket.id && !p.isBot)) return;
    socket.emit("taki:update", serializeTakiRoom(room, socket.id));
  });

  socket.on("taki:start", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח יכול להתחיל" });
      return;
    }
    if (room.phase !== "lobby") {
      if (typeof cb === "function") cb({ ok: false, error: "לא בלובי" });
      return;
    }
    const n = room.players.length;
    if (room.solo) {
      if (n !== 4) {
        if (typeof cb === "function") cb({ ok: false, error: "חסרים שחקנים" });
        return;
      }
    } else if (n < 2 || n > 4) {
      if (typeof cb === "function") cb({ ok: false, error: "נדרשים בין 2 ל־4 שחקנים" });
      return;
    }
    takiStartRound(room);
    room.phase = "playing";
    room.lastResult = null;
    broadcastTaki(io, room);
    takiMaybeBot(io, code);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("taki:play", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const cardId = payload && payload.cardId;
    if (!cardId || typeof cardId !== "string") {
      if (typeof cb === "function") cb({ ok: false, error: "חסר קלף" });
      return;
    }
    const res = takiPlayCard(room, socket.id, cardId, io, code);
    if (typeof cb === "function") cb(res);
  });

  socket.on("taki:draw", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const res = takiDraw(room, socket.id, io, code);
    if (typeof cb === "function") cb(res);
  });

  socket.on("taki:takiDone", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const res = takiTakiDone(room, socket.id, io, code);
    if (typeof cb === "function") cb(res);
  });

  socket.on("taki:pickColor", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.phase !== "playing") {
      if (typeof cb === "function") cb({ ok: false, error: "לא במשחק" });
      return;
    }
    const color = payload && payload.color;
    const res = takiPickColor(room, socket.id, color, io, code);
    if (typeof cb === "function") cb(res);
  });

  socket.on("taki:again", (payload, cb) => {
    const code = socket.data.takiCode;
    const room = code && takiRooms.get(code);
    if (!room || room.hostId !== socket.id) {
      if (typeof cb === "function") cb({ ok: false, error: "רק המארח" });
      return;
    }
    if (room.phase !== "result") {
      if (typeof cb === "function") cb({ ok: false, error: "לא אפשרי" });
      return;
    }
    takiStartRound(room);
    room.phase = "playing";
    room.lastResult = null;
    broadcastTaki(io, room);
    takiMaybeBot(io, code);
    if (typeof cb === "function") cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const sid = socket.id;
    const code = socket.data.roomCode;
    const rpsCode = socket.data.rpsCode;
    const aeCode = socket.data.aeCode;
    const xoCode = socket.data.xoCode;

    if (code) {
      const room = rooms.get(code);
      if (room) {
        const delayMs = room.phase === "lobby" ? 120000 : 90000;
        cancelPendingLeave(sid);
        const tid = setTimeout(() => {
          pendingLeave.delete(sid);
          const r = rooms.get(code);
          if (!r) return;
          if (!r.players.some((p) => p.id === sid)) return;
          leaveRoom(sid, io);
        }, delayMs);
        pendingLeave.set(sid, tid);
      }
      return;
    }

    if (rpsCode) {
      const room = rpsRooms.get(rpsCode);
      if (room) {
        const delayMs = room.phase === "lobby" ? 120000 : 90000;
        cancelPendingRpsLeave(sid);
        const tid = setTimeout(() => {
          pendingRpsLeave.delete(sid);
          const r = rpsRooms.get(rpsCode);
          if (!r) return;
          if (!r.players.some((p) => p.id === sid)) return;
          leaveRpsRoom(sid, io);
        }, delayMs);
        pendingRpsLeave.set(sid, tid);
      }
      return;
    }

    if (aeCode) {
      const room = aeRooms.get(aeCode);
      if (room) {
        const delayMs = room.phase === "lobby" ? 120000 : 90000;
        cancelPendingAeLeave(sid);
        const tid = setTimeout(() => {
          pendingAeLeave.delete(sid);
          const r = aeRooms.get(aeCode);
          if (!r) return;
          if (!r.players.some((p) => p.id === sid)) return;
          leaveAeRoom(sid, io);
        }, delayMs);
        pendingAeLeave.set(sid, tid);
      }
      return;
    }

    if (xoCode) {
      const room = xoRooms.get(xoCode);
      if (room) {
        const delayMs = room.phase === "lobby" ? 120000 : 90000;
        cancelPendingXoLeave(sid);
        const tid = setTimeout(() => {
          pendingXoLeave.delete(sid);
          const r = xoRooms.get(xoCode);
          if (!r) return;
          if (!r.players.some((p) => p.id === sid)) return;
          leaveXoRoom(sid, io);
        }, delayMs);
        pendingXoLeave.set(sid, tid);
      }
      return;
    }

    const takiCode = socket.data.takiCode;
    if (takiCode) {
      const room = takiRooms.get(takiCode);
      if (room) {
        const delayMs = room.phase === "lobby" ? 120000 : 90000;
        cancelPendingTakiLeave(sid);
        const tid = setTimeout(() => {
          pendingTakiLeave.delete(sid);
          const r = takiRooms.get(takiCode);
          if (!r) return;
          if (!r.players.some((p) => p.id === sid)) return;
          leaveTakiRoom(sid, io);
        }, delayMs);
        pendingTakiLeave.set(sid, tid);
      }
    }
  });
});

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`משחק המשפטים — listening on ${HOST}:${PORT}`);
});
