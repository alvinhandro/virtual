
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const ROOM_PIN = process.env.ROOM_PIN || "";
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE) || 12;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.socket.io"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);

// Health check for Render
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    service: "Remote Audio Link",
    timestamp: new Date().toISOString()
  });
});

// Main frontend page
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Serve frontend assets
app.use(express.static(PUBLIC_DIR));

// Room storage
const rooms = new Map();

function cleanRoom(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 24);
}

function cleanName(value) {
  return String(value || "Guest")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 32) || "Guest";
}

function getPeers(room, excludeId) {
  const members = rooms.get(room);
  if (!members) return [];

  return [...members.values()]
    .filter(peer => peer.id !== excludeId)
    .map(peer => ({
      id: peer.id,
      name: peer.name,
      role: peer.role
    }));
}

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 100000
});

// Validate room access
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};

  const room = cleanRoom(auth.room);
  const pin = String(auth.pin || "");
  const role = ["source", "listener", "both"].includes(auth.role)
    ? auth.role
    : "source";

  if (!/^[A-Z0-9-]{4,24}$/.test(room)) {
    return next(new Error("Invalid room code."));
  }

  if (ROOM_PIN && pin !== ROOM_PIN) {
    return next(new Error("Incorrect room PIN."));
  }

  socket.data.room = room;
  socket.data.name = cleanName(auth.name);
  socket.data.role = role;

  next();
});

// Handle connections
io.on("connection", socket => {
  const room = socket.data.room;

  if (!rooms.has(room) && rooms.size >= MAX_ROOMS) {
    socket.emit("app-error", "Server room limit reached.");
    socket.disconnect(true);
    return;
  }

  if (!rooms.has(room)) {
    rooms.set(room, new Map());
  }

  const members = rooms.get(room);

  if (members.size >= MAX_ROOM_SIZE) {
    socket.emit("app-error", "Room is full.");
    socket.disconnect(true);
    return;
  }

  const existingPeers = getPeers(room);

  const peer = {
    id: socket.id,
    name: socket.data.name,
    role: socket.data.role
  };

  members.set(socket.id, peer);
  socket.join(room);

  socket.emit("room-ready", {
    selfId: socket.id,
    room,
    peers: existingPeers
  });

  socket.to(room).emit("peer-joined", { peer });

  // WebRTC signaling
  socket.on("signal", message => {
    if (!message || typeof message.to !== "string") return;

    if (!members.has(message.to)) return;
    if (message.to === socket.id) return;

    const payload = { from: socket.id };

    if (message.description) {
      payload.description = message.description;
    }

    if (message.candidate) {
      payload.candidate = message.candidate;
    }

    io.to(message.to).emit("signal", payload);
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    const currentMembers = rooms.get(room);
    if (!currentMembers) return;

    currentMembers.delete(socket.id);

    socket.to(room).emit("peer-left", {
      id: socket.id
    });

    if (currentMembers.size === 0) {
      rooms.delete(room);
    }
  });
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Remote Audio Link running on port ${PORT}`);
  console.log(`Frontend directory: ${PUBLIC_DIR}`);
});
