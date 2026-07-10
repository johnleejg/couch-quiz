import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 4173);
const uploadsDirectory = path.join(__dirname, "uploads");
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });
const rooms = new Map();
const questionIntroSeconds = 4;

fs.mkdirSync(uploadsDirectory, { recursive: true });

const isPrivateAddress = (address) =>
  address.startsWith("10.") ||
  address.startsWith("192.168.") ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address);

const getLanAddress = () => {
  const candidates = [];
  for (const [interfaceName, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal || address.address.startsWith("169.254.")) continue;
      const preferredInterface = /^(en|eth|wlan)/i.test(interfaceName);
      candidates.push({
        address: address.address,
        score: (preferredInterface ? 2 : 0) + (isPrivateAddress(address.address) ? 1 : 0),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.address || "localhost";
};

const publicOrigin = String(process.env.PUBLIC_URL || `http://${getLanAddress()}:${port}`).replace(/\/$/, "");

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (_, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, "") || ".jpg";
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, callback) => callback(null, file.mimetype.startsWith("image/")),
});

app.use("/uploads", express.static(uploadsDirectory));
app.get("/api/config", (_, res) => res.json({ publicOrigin }));
app.post("/api/uploads", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image file." });
  return res.json({ url: `/uploads/${req.file.filename}` });
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (_, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const createCode = () => {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
};

const cleanUrl = (value) => {
  const url = String(value || "").trim().slice(0, 500);
  if (url.startsWith("/uploads/")) return url;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const normalizeMedia = (media) => {
  const kind = ["image", "youtube", "vimeo"].includes(media?.kind) ? media.kind : "";
  const url = cleanUrl(media?.url);
  return kind && url ? { kind, url } : null;
};

const normalizeQuestion = (rawQuestion, questionIndex) => {
  const type = rawQuestion?.type === "true-false" ? "true-false" : "quiz";
  const prompt = String(rawQuestion?.prompt || "").trim().slice(0, 120);
  const seconds = Math.max(5, Math.min(240, Number(rawQuestion?.seconds) || 20));
  const points = [0, 1000, 2000].includes(Number(rawQuestion?.points))
    ? Number(rawQuestion.points)
    : 1000;
  const media = normalizeMedia(rawQuestion?.media);

  if (!prompt) throw new Error(`Question ${questionIndex + 1} needs question text.`);

  if (type === "true-false") {
    const legacyCorrect = Number(rawQuestion?.correctIndex);
    const requested = Array.isArray(rawQuestion?.correctIndexes)
      ? Number(rawQuestion.correctIndexes[0])
      : legacyCorrect;
    return {
      type,
      prompt,
      seconds,
      points,
      media,
      multiSelect: false,
      options: [
        { text: "True", imageUrl: "" },
        { text: "False", imageUrl: "" },
      ],
      correctIndexes: [requested === 1 ? 1 : 0],
    };
  }

  const rawOptions = (Array.isArray(rawQuestion?.options) ? rawQuestion.options : [])
    .slice(0, 6)
    .map((option, originalIndex) => ({
      originalIndex,
      text: String(typeof option === "string" ? option : option?.text || "").trim().slice(0, 75),
      imageUrl: cleanUrl(typeof option === "object" ? option?.imageUrl : ""),
    }))
    .filter((option) => option.text || option.imageUrl);

  if (rawOptions.length < 2) {
    throw new Error(`Question ${questionIndex + 1} needs at least two non-blank answers.`);
  }

  const rawCorrectIndexes = Array.isArray(rawQuestion?.correctIndexes)
    ? rawQuestion.correctIndexes.map(Number)
    : [Number(rawQuestion?.correctIndex) || 0];
  const indexMap = new Map(rawOptions.map((option, index) => [option.originalIndex, index]));
  let correctIndexes = [...new Set(rawCorrectIndexes)]
    .map((index) => indexMap.get(index))
    .filter((index) => Number.isInteger(index));
  const multiSelect = Boolean(rawQuestion?.multiSelect);
  if (!multiSelect) correctIndexes = correctIndexes.slice(0, 1);

  if (!correctIndexes.length) {
    throw new Error(`Question ${questionIndex + 1} needs at least one correct non-blank answer.`);
  }

  return {
    type,
    prompt,
    seconds,
    points,
    media,
    multiSelect,
    options: rawOptions.map(({ text, imageUrl }) => ({ text, imageUrl })),
    correctIndexes,
  };
};

const normalizeQuiz = (rawQuiz) => {
  const rawQuestions = (Array.isArray(rawQuiz?.questions) ? rawQuiz.questions : []).slice(0, 50);
  if (!rawQuestions.length) throw new Error("Add at least one question.");
  return {
    title: String(rawQuiz?.title || "Friday Night Trivia").trim().slice(0, 60),
    theme: rawQuiz?.theme === "cupertino" ? "cupertino" : "premium",
    questions: rawQuestions.map(normalizeQuestion),
  };
};

const leaderboard = (room) =>
  [...room.players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map(({ id, name, score, streak, online }) => ({ id, name, score, streak, online }));

const withRankData = (players, previousStandings = []) => {
  const previousById = new Map(
    previousStandings.map((player, index) => [
      player.id,
      { rank: index + 1, score: player.score },
    ]),
  );
  return players.map((player, index) => {
    const previous = previousById.get(player.id) || { rank: index + 1, score: player.score };
    return {
      ...player,
      rank: index + 1,
      previousRank: previous.rank,
      rankChange: previous.rank - (index + 1),
      scoreBefore: previous.score,
      pointsGained: Math.max(0, player.score - previous.score),
    };
  });
};

const chooseFunStat = ({ room, standings, roundResults, correctCount, answeredCount }) => {
  const candidates = [];
  const playerCount = room.players.size;
  const fastest = roundResults
    .filter((result) => result.answer)
    .sort((a, b) => b.answer.remaining - a.answer.remaining)[0];
  const fastestCorrect = roundResults
    .filter((result) => result.correct && result.answer)
    .sort((a, b) => b.answer.remaining - a.answer.remaining)[0];
  const topStreak = standings.find((player) => player.streak >= 3);
  const biggestClimber = standings
    .filter((player) => player.rankChange > 0)
    .sort((a, b) => b.rankChange - a.rankChange || b.pointsGained - a.pointsGained)[0];
  const topRoundScore = standings
    .filter((player) => player.pointsGained > 0)
    .sort((a, b) => b.pointsGained - a.pointsGained)[0];
  const leader = standings[0];
  const second = standings[1];

  if (fastest) {
    candidates.push({
      label: "Fastest fingers",
      text: `${fastest.player.name} locked in with ${fastest.answer.remaining}s left.`,
    });
  }
  if (fastestCorrect) {
    candidates.push({
      label: "Quickest correct",
      text: `${fastestCorrect.player.name} was first to nail it.`,
    });
  }
  if (topStreak) {
    candidates.push({
      label: "Hot streak",
      text: `${topStreak.name} is riding a ${topStreak.streak}-answer streak.`,
    });
  }
  if (correctCount === playerCount && playerCount > 1) {
    candidates.push({
      label: "Clean sweep",
      text: "Everybody got it right. The couch is locked in.",
    });
  }
  if (correctCount === 0 && answeredCount > 0) {
    candidates.push({
      label: "Stumper",
      text: "Nobody found the right answer that round.",
    });
  }
  if (correctCount === 1 && playerCount > 2) {
    const solo = roundResults.find((result) => result.correct);
    candidates.push({
      label: "Solo genius",
      text: `${solo.player.name} was the only one who got it right.`,
    });
  }
  if (biggestClimber) {
    candidates.push({
      label: "Biggest jump",
      text: `${biggestClimber.name} climbed ${biggestClimber.rankChange} spot${biggestClimber.rankChange === 1 ? "" : "s"}.`,
    });
  }
  if (topRoundScore) {
    candidates.push({
      label: "Point burst",
      text: `${topRoundScore.name} added ${topRoundScore.pointsGained.toLocaleString()} points.`,
    });
  }
  if (leader && second) {
    const gap = leader.score - second.score;
    candidates.push({
      label: gap <= 500 ? "Photo finish" : "Setting the pace",
      text:
        gap <= 500
          ? `${second.name} is only ${gap.toLocaleString()} points behind ${leader.name}.`
          : `${leader.name} leads by ${gap.toLocaleString()} points.`,
    });
  }

  if (!candidates.length) {
    return { label: "Round complete", text: "Scores are updated. Next question is waiting." };
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
};

const publicState = (room) => {
  const question = room.quiz.questions[room.questionIndex];
  return {
    code: room.code,
    joinUrl: room.joinUrl,
    title: room.quiz.title,
    theme: room.quiz.theme,
    phase: room.phase,
    questionIndex: room.questionIndex,
    questionCount: room.quiz.questions.length,
    question:
      question && ["intro", "question", "results", "leaderboard"].includes(room.phase)
        ? {
            type: question.type,
            prompt: question.prompt,
            options: question.options,
            seconds: question.seconds,
            points: question.points,
            media: question.media,
            multiSelect: question.multiSelect,
            correctIndexes: ["results", "leaderboard"].includes(room.phase) ? question.correctIndexes : null,
          }
        : null,
    secondsLeft: room.secondsLeft,
    answeredCount: room.answers.size,
    playerCount: room.players.size,
    players: leaderboard(room),
    roundSummary: room.roundSummary,
  };
};

const emitRoom = (room) => {
  for (const player of room.players.values()) {
    io.to(player.socketId).emit("player:state", {
      id: player.id,
      name: player.name,
      score: player.score,
      streak: player.streak,
      selectedIndexes: room.answers.get(player.id)?.indexes ?? null,
      lastResult: player.lastResult,
    });
  }
  io.to(room.code).emit("room:state", publicState(room));
};

const sameIndexes = (left = [], right = []) => {
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
};

const finishQuestion = (room) => {
  if (room.phase !== "question") return;
  clearInterval(room.timer);
  room.phase = "results";
  room.secondsLeft = 0;
  const question = room.quiz.questions[room.questionIndex];
  const roundResults = [];
  const answerStats = question.options.map((option, index) => ({
    index,
    label: option.text || `Answer ${index + 1}`,
    count: 0,
    correct: question.correctIndexes.includes(index),
  }));
  let correctCount = 0;

  for (const player of room.players.values()) {
    const answer = room.answers.get(player.id);
    const correct = Boolean(answer && sameIndexes(answer.indexes, question.correctIndexes));
    let points = 0;
    if (correct) {
      player.streak += 1;
      const speedRatio = Math.max(0, answer.remaining / question.seconds);
      points = Math.round(question.points * (0.5 + speedRatio * 0.5));
      player.score += points;
      player.lastResult = { correct: true, points };
      correctCount += 1;
    } else {
      player.streak = 0;
      player.lastResult = { correct: false, points: 0 };
    }
    for (const index of answer?.indexes || []) {
      if (answerStats[index]) answerStats[index].count += 1;
    }
    roundResults.push({ player, answer, correct, points });
  }
  const responseBase = Math.max(1, room.players.size);
  const answerStatsWithPercent = answerStats.map((item) => ({
    ...item,
    percent: Math.round((item.count / responseBase) * 100),
  }));
  const standings = withRankData(leaderboard(room), room.previousStandings);
  const topTen = standings.slice(0, 10);
  const topFive = standings.slice(0, 5);
  const nextQuestionIndex =
    room.questionIndex >= room.quiz.questions.length - 1 ? null : room.questionIndex + 1;
  room.roundSummary = {
    questionIndex: room.questionIndex,
    nextQuestionIndex,
    isFinalRound: nextQuestionIndex === null,
    topFive,
    topTen,
    funStat: chooseFunStat({
      room,
      standings,
      roundResults,
      correctCount,
      answeredCount: room.answers.size,
    }),
    correctCount,
    answeredCount: room.answers.size,
    answerStats: answerStatsWithPercent,
  };
  for (const player of room.players.values()) {
    const standing = standings.find((item) => item.id === player.id);
    const ahead = standings[standing.rank - 2] || null;
    player.lastResult = {
      ...player.lastResult,
      rank: standing.rank,
      previousRank: standing.previousRank,
      rankChange: standing.rankChange,
      pointsBehindNext: ahead ? Math.max(0, ahead.score - standing.score) : 0,
      nextPlayerName: ahead?.name || null,
    };
  }
  emitRoom(room);
};

const startQuestion = (room) => {
  clearInterval(room.timer);
  clearTimeout(room.timer);
  room.phase = "intro";
  room.answers = new Map();
  room.roundSummary = null;
  room.previousStandings = leaderboard(room);
  const question = room.quiz.questions[room.questionIndex];
  room.secondsLeft = question.seconds;
  for (const player of room.players.values()) player.lastResult = null;
  emitRoom(room);
  room.timer = setTimeout(() => beginQuestion(room), questionIntroSeconds * 1000);
};

const beginQuestion = (room) => {
  if (room.phase !== "intro") return;
  room.phase = "question";
  const question = room.quiz.questions[room.questionIndex];
  room.secondsLeft = question.seconds;
  emitRoom(room);
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.secondsLeft -= 1;
    if (room.secondsLeft <= 0) finishQuestion(room);
    else emitRoom(room);
  }, 1000);
};

const requireHost = (socket, code, action) => {
  const room = rooms.get(code);
  if (!room || room.hostSocketId !== socket.id) {
    socket.emit("app:error", "Only the host can do that.");
    return null;
  }
  action(room);
  return room;
};

io.on("connection", (socket) => {
  socket.on("host:create", (rawQuiz, respond) => {
    let quiz;
    try {
      quiz = normalizeQuiz(rawQuiz);
    } catch (error) {
      respond?.({ ok: false, error: error.message });
      return;
    }

    const code = createCode();
    const hostKey = crypto.randomUUID();
    const room = {
      code,
      joinUrl: `${publicOrigin}/play?room=${code}`,
      hostKey,
      hostSocketId: socket.id,
      quiz,
      phase: "lobby",
      questionIndex: 0,
      secondsLeft: 0,
      players: new Map(),
      answers: new Map(),
      timer: null,
    };
    rooms.set(code, room);
    socket.join(code);
    respond?.({ ok: true, code, hostKey, joinUrl: room.joinUrl });
    emitRoom(room);
  });

  socket.on("host:resume", ({ code, hostKey }, respond) => {
    const room = rooms.get(String(code || "").replace(/\D/g, ""));
    if (!room || room.hostKey !== hostKey) {
      respond?.({ ok: false });
      return;
    }
    room.hostSocketId = socket.id;
    socket.join(room.code);
    respond?.({ ok: true });
    emitRoom(room);
  });

  socket.on("host:start", ({ code }) =>
    requireHost(socket, code, (room) => {
      if (room.phase === "lobby" && room.players.size > 0) startQuestion(room);
    }),
  );

  socket.on("host:reveal", ({ code }) => requireHost(socket, code, finishQuestion));

  socket.on("host:end", ({ code }) =>
    requireHost(socket, code, (room) => {
      if (room.phase === "finished") return;
      clearInterval(room.timer);
      clearTimeout(room.timer);
      room.secondsLeft = 0;
      room.phase = "finished";
      room.roundSummary = {
        ...(room.roundSummary || {}),
        topTen: withRankData(leaderboard(room), room.previousStandings || leaderboard(room)).slice(0, 10),
      };
      emitRoom(room);
    }),
  );

  socket.on("host:next", ({ code }) =>
    requireHost(socket, code, (room) => {
      if (room.phase === "results") {
        room.phase = "leaderboard";
        emitRoom(room);
        return;
      }
      if (room.phase !== "leaderboard") return;
      if (room.questionIndex >= room.quiz.questions.length - 1) {
        room.phase = "finished";
        room.roundSummary = {
          ...room.roundSummary,
          topTen: withRankData(leaderboard(room), room.previousStandings).slice(0, 10),
        };
        emitRoom(room);
      } else {
        room.questionIndex += 1;
        startQuestion(room);
      }
    }),
  );

  socket.on("player:join", ({ code: rawCode, name: rawName, playerKey }, respond) => {
    const code = String(rawCode || "").replace(/\D/g, "");
    const name = String(rawName || "").trim().slice(0, 20);
    const room = rooms.get(code);
    if (!room) return respond?.({ ok: false, error: "That room does not exist." });
    if (!name) return respond?.({ ok: false, error: "Enter a name first." });
    if (room.phase === "finished") return respond?.({ ok: false, error: "That game has finished." });

    let player = [...room.players.values()].find((item) => item.key === playerKey);
    if (!player && room.phase !== "lobby") {
      return respond?.({ ok: false, error: "This game has already started." });
    }
    if (!player) {
      const duplicate = [...room.players.values()].some(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      );
      if (duplicate) return respond?.({ ok: false, error: "That name is already taken." });
      player = {
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        name,
        score: 0,
        streak: 0,
        joinedAt: Date.now(),
        lastResult: null,
      };
      room.players.set(player.id, player);
    }
    player.socketId = socket.id;
    player.online = true;
    socket.data.player = { code, playerId: player.id };
    socket.join(code);
    respond?.({ ok: true, playerKey: player.key, playerId: player.id });
    emitRoom(room);
  });

  socket.on("player:answer", ({ code, indexes }) => {
    const room = rooms.get(code);
    const identity = socket.data.player;
    if (!room || room.phase !== "question" || identity?.code !== code) return;
    if (room.answers.has(identity.playerId)) return;

    const question = room.quiz.questions[room.questionIndex];
    let selectedIndexes = [...new Set((Array.isArray(indexes) ? indexes : []).map(Number))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < question.options.length)
      .sort((a, b) => a - b);
    if (!question.multiSelect) selectedIndexes = selectedIndexes.slice(0, 1);
    if (!selectedIndexes.length) return;

    room.answers.set(identity.playerId, {
      indexes: selectedIndexes,
      remaining: room.secondsLeft,
    });
    emitRoom(room);
    if (room.answers.size === room.players.size) {
      setTimeout(() => finishQuestion(room), 450);
    }
  });

  socket.on("disconnect", () => {
    const identity = socket.data.player;
    if (!identity) return;
    const room = rooms.get(identity.code);
    const player = room?.players.get(identity.playerId);
    if (player) {
      player.online = false;
      emitRoom(room);
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Couch Quiz is running at http://localhost:${port}`);
  console.log(`On your Wi-Fi: ${publicOrigin}`);
});
