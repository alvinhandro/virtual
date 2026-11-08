import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import helmet from "helmet";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
const ROOM_PIN = process.env.ROOM_PIN || "";
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE || 12);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 100);

app.disable("x-powered-by");
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(express.static("public", { extensions: ["html"] }));



const path = require("path");
const express = require("express");


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || CLIENT_ORIGIN.length === 0 || CLIENT_ORIGIN.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e5,
  transports: ["websocket", "polling"]
});

const rooms = new Map();
const cleanRoom = value => String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
const cleanName = value => String(value || "Guest").replace(/[<>]/g, "").trim().slice(0, 32) || "Guest";

function publicPeers(room, exceptId) {
  return [...(rooms.get(room)?.values() || [])]
    .filter(p => p.id !== exceptId)
    .map(({ id, name, role }) => ({ id, name, role }));
}

io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const room = cleanRoom(auth.room);
  const name = cleanName(auth.name);
  const role = ["source", "listener", "both"].includes(auth.role) ? auth.role : "source";
  const pin = String(auth.pin || "");
  if (!/^[A-Z0-9-]{4,24}$/.test(room)) return next(new Error("Enter a room code of 4–24 letters/numbers."));
  if (ROOM_PIN && pin !== ROOM_PIN) return next(new Error("Incorrect room PIN."));
  socket.data.room = room;
  socket.data.name = name;
  socket.data.role = role;
  next();
});

io.on("connection", socket => {
  const room = socket.data.room;
  if (!rooms.has(room) && rooms.size >= MAX_ROOMS) {
    socket.emit("app-error", "Server room limit reached. Try again later.");
    socket.disconnect(true);
    return;
  }
  if (!rooms.has(room)) rooms.set(room, new Map());
  const members = rooms.get(room);
  if (members.size >= MAX_ROOM_SIZE) {
    socket.emit("app-error", "This room is full.");
    socket.disconnect(true);
    return;
  }

  const existing = publicPeers(room);
  members.set(socket.id, { id: socket.id, name: socket.data.name, role: socket.data.role });
  socket.join(room);
  socket.emit("room-ready", {
    selfId: socket.id,
    peers: existing,
    room,
    maxRoomSize: MAX_ROOM_SIZE
  });
  socket.to(room).emit("peer-joined", {
    peer: { id: socket.id, name: socket.data.name, role: socket.data.role }
  });

  socket.on("signal", ({ to, description, candidate } = {}) => {
    if (typeof to !== "string" || !members.has(to)) return;
    const payload = { from: socket.id };
    if (description && typeof description === "object") payload.description = description;
    if (candidate && typeof candidate === "object") payload.candidate = candidate;
    io.to(to).emit("signal", payload);
  });

  socket.on("disconnect", () => {
    members.delete(socket.id);
    socket.to(room).emit("peer-left", { id: socket.id });
    if (members.size === 0) rooms.delete(room);
  });
});

server.listen(PORT, () => console.log(`Remote Audio Link listening on ${PORT}`));
